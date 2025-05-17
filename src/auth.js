
function authMiddleware(request, response, next) {
    // check if Authorization header matches the API key in environment
    const authHeader = request.headers.authorization;

    if (!authHeader) {
        return response.status(401).json({
            error: 'Authorization header is missing'
        });
    }

    // Extract the token from Bearer format if present
    const token = authHeader.startsWith('Bearer ') 
        ? authHeader.substring(7) 
        : authHeader;

    if (!process.env.API_KEY) {
        return response.status(500).json({
            error: 'API_KEY environment variable is not set'
        });
    }

    if (token !== process.env.API_KEY) {
        return response.status(401).json({
            error: 'Invalid API key'
        });
    }

    next();
}

module.exports = {
    authMiddleware
}