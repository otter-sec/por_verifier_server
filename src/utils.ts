import ipaddr from "ipaddr.js";
import net from "node:net";
import dns from "node:dns";
import BigNumber from "bignumber.js";
import { ZK_FIELD_ORDER } from "./constants";
import { execSync } from "node:child_process";

function isPrivateIp(ip: string): boolean {
  return ipaddr.parse(ip).range() !== "unicast";
}

function isValidPort(port: string | number): boolean {
  const portNum = typeof port === "string" ? parseInt(port, 10) : port;
  return portNum >= 1 && portNum <= 65535;
}

type ResolvedUrl = [string, number];

export async function resolveAndValidateUrl(url: string): Promise<ResolvedUrl> {
  if (!url.startsWith("http")) {
    throw new Error("Invalid URL");
  }

  const parsedUrl = new URL(url);

  // check if it is a valid port
  if (parsedUrl.port && !isValidPort(parsedUrl.port)) {
    throw new Error("Invalid port");
  }

  // resolve the hostname awaiting for the result
  const [resolvedIp, family] = await new Promise<ResolvedUrl>(
    (resolve, reject) =>
      dns.lookup(
        parsedUrl.hostname,
        (err: Error | null, address: string, family: number) => {
          if (err) {
            reject(err);
          } else {
            resolve([address, family]);
          }
        }
      )
  );

  // check if ip is internal
  if (
    !net.isIP(resolvedIp) ||
    (isPrivateIp(resolvedIp) &&
      !["development", "test"].includes(process.env.NODE_ENV || ""))
  ) {
    throw new Error("Invalid IP address");
  }

  return [resolvedIp, family];
}

export function parseFinalProof(finalProof: any) {
  const proofTimestamp = finalProof.timestamp;
  const proverVersion = finalProof.prover_version;
  const asset_names = finalProof.asset_names;
  const asset_decimals = finalProof.asset_decimals;
  const asset_count = asset_names.length;

  // get the ZK public inputs from final proof
  const publicInputs = finalProof.proof.public_inputs;

  const balances = publicInputs.slice(0, asset_count);
  const prices = publicInputs.slice(asset_count, asset_count * 2);

  // convert to correct decimals using BigNumber
  const balancesWithDecimals = balances.map(
    (balance: number, index: number) => {
      return BigNumber(balance % ZK_FIELD_ORDER).div(
        BigNumber(10).pow(asset_decimals[index].balance_decimals)
      );
    }
  );
  const pricesWithDecimals = prices.map((price: number, index: number) => {
    return BigNumber(price % ZK_FIELD_ORDER).div(
      BigNumber(10).pow(asset_decimals[index].usdt_decimals)
    );
  });

  // Create combined assets structure
  const assets = asset_names.reduce((acc: any, name: string, index: number) => {
    acc[name] = {
      price: pricesWithDecimals[index].toString(),
      balance: balancesWithDecimals[index].toString(),
      usd_balance: balancesWithDecimals[index]
        .multipliedBy(pricesWithDecimals[index])
        .toFixed(2, BigNumber.ROUND_UP)
        .toString(),
    };
    return acc;
  }, {});

  return {
    proofTimestamp,
    proverVersion,
    assets,
  };
}

export function formatMoney(numberString: string): string {
  // Handle empty or invalid input
  if (!numberString || numberString === "0") {
    return "0";
  }

  // Split by decimal point
  const parts = numberString.toString().split(".");
  const integerPart = parts[0];
  let decimalPart = parts[1];

  // Add thousands commas to integer part
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");

  // Concatenate with decimal part if it exists
  if (decimalPart !== undefined) {
    if (decimalPart.length < 2) {
      decimalPart = decimalPart.padEnd(2, "0");
    }

    return `${formattedInteger}.${decimalPart}`;
  }

  return formattedInteger + ".00";
}

export function getProverVersion(): string {
  try {
    let output = execSync("plonky2_por version").toString();

    // parse with regex
    const regex = /(v\d+\.\d+\.\d+)/;
    const match = output.match(regex);
    return match ? match[1] : "unknown";
  } catch (error) {
    return "unknown";
  }
}
