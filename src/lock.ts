// Mutex-like lock mechanism
let isVerifying = false;
const verificationQueue: Array<() => void> = [];

export function acquireLock(): Promise<void> {
    return new Promise((resolve) => {
        if (!isVerifying) {
            isVerifying = true;
            resolve();
        } else {
            verificationQueue.push(resolve);
        }
    });
}

export function releaseLock(): void {
    const nextResolver = verificationQueue.shift();
    if (nextResolver) {
        nextResolver();
    } else {
        isVerifying = false;
    }
}
