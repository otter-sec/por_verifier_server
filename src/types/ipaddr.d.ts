declare module 'ipaddr.js' {
    class IPv4 {
        octets: number[];
        constructor(octets: number[]);
        toString(): string;
        toNormalizedString(): string;
        toByteArray(): number[];
        match(addr: IPv4, bits: number): boolean;
        range(): string;
        kind(): 'ipv4';
    }

    class IPv6 {
        parts: number[];
        constructor(parts: number[]);
        toString(): string;
        toNormalizedString(): string;
        toByteArray(): number[];
        match(addr: IPv6, bits: number): boolean;
        range(): string;
        kind(): 'ipv6';
    }

    type IP = IPv4 | IPv6;

    function parse(input: string): IP;
    function isValid(input: string): boolean;
    function process(input: string): IP;
    function subnetMatch(addr: IP, rangeList: { [key: string]: any }, defaultName?: string): string;

    export {
        IPv4,
        IPv6,
        IP,
        parse,
        isValid,
        process,
        subnetMatch
    };
} 