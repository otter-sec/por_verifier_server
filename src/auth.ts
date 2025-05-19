import { Request, Response, NextFunction } from 'express';

export function authMiddleware(
    request: Request,
    response: Response,
    next: NextFunction
): void {
    // check if Authorization header matches the API key in environment
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

    if (!process.env.API_KEY) {
        response.status(500).json({
            error: 'API_KEY environment variable is not set'
        });
        return;
    }

    if (token !== process.env.API_KEY) {
        response.status(401).json({
            error: 'Invalid API key'
        });
        return;
    }

    next();
} 