import ipaddr from "ipaddr.js";
import net from 'node:net';
import dns from 'node:dns';

function isPrivateIp(ip: string): boolean {
    return ipaddr.parse(ip).range() !== "unicast";
}

function isValidPort(port: string | number): boolean {
    const portNum = typeof port === 'string' ? parseInt(port, 10) : port;
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
    const [resolvedIp, family] = await new Promise<ResolvedUrl>((resolve, reject) => 
        dns.lookup(parsedUrl.hostname, (err: Error | null, address: string, family: number) => {
            if (err) {
                reject(err);
            } else {
                resolve([address, family]);
            }
        })
    );

    // check if ip is internal
    if (!net.isIP(resolvedIp) || (isPrivateIp(resolvedIp) && !["development", "test"].includes(process.env.NODE_ENV || ''))) {
        throw new Error("Invalid IP address");
    }

    return [resolvedIp, family];
} 