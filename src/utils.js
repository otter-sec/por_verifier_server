const ipaddr = require("ipaddr.js");
const net = require('node:net');
const dns = require('node:dns');

function isPrivateIp(ip) {
    return ipaddr.parse(ip).range() !== "unicast";
}

function isValidPort(port) {
    return port >= 1 && port <= 65535;
}

async function resolveAndValidateUrl(url) {
    if (!url.startsWith("http")) {
        throw new Error("Invalid URL");
    }

    let parsedUrl = new URL(url);

    // check if it is a valid port
    if (parsedUrl.port && !isValidPort(parsedUrl.port)) {
        throw new Error("Invalid port");
    }

    // resolve the hostname awaiting for the result
    const [resolvedIp, family] = await new Promise((resolve, reject) => dns.resolve(parsedUrl.hostname, (err, ip, family) => {
        if (err) {
            reject(err);
        } else {
            resolve([ip[0], family]);
        }
    }));

    // check if ip is internal
    if (!net.isIP(resolvedIp) || isPrivateIp(resolvedIp) && !["development", "test"].includes(process.env.NODE_ENV)) {
        throw new Error("Invalid IP address");
    }

    return [resolvedIp, family];
}

module.exports = {
    resolveAndValidateUrl
}
