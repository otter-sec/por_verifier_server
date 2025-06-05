import { Request, Response, NextFunction } from 'express';

export function adminAuthMiddleware(
    request: Request,
    response: Response,
    next: NextFunction
): void {
    // check if Authorization header matches the ADMIN_API_KEY in environment
    const authHeader = request.headers.authorization;

    if (!authHeader) {
        response.status(401).json({
            error: 'Authorization header is missing'
        });
        return;
    }

    // Extract the token from Bearer format if present
    const token = authHeader.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : authHeader;

    if (!process.env.ADMIN_API_KEY) {
        response.status(500).json({
            error: 'ADMIN_API_KEY environment variable is not set'
        });
        return;
    }

    if (token !== process.env.ADMIN_API_KEY) {
        response.status(401).json({
            error: 'Invalid admin API key'
        });
        return;
    }

    next();
} 