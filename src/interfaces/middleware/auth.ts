import { Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { TenantRequest } from '../http/types';

// ══════════════════════════════════════════════════════════════
//  JWT AUTHENTICATION MIDDLEWARE
//  Protects tenant-scoped routes by verifying a Bearer token.
//  Token payload must include { userId, businessIds[] } to
//  establish identity and authorized tenant scope.
// ══════════════════════════════════════════════════════════════

const JWT_SECRET = process.env.JWT_SECRET || 'businessflow-default-secret-change-me';
const JWT_EXPIRY = process.env.JWT_EXPIRY || '24h';

export interface JwtPayload {
  userId: string;
  email: string;
  role: 'admin' | 'agent' | 'viewer';
  businessIds: string[]; // list of businesses this user can access
  iat?: number;
  exp?: number;
}

/**
 * Middleware: Verify JWT token from Authorization header.
 * Attaches decoded user info to req.user.
 * 
 * Usage: router.use(authMiddleware);
 */
export function authMiddleware(req: TenantRequest, res: Response, next: NextFunction): void {
  // Allow health check and public routes to bypass auth
  if (req.path === '/health' || req.path === '/webhook') {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required. Provide a Bearer token.' });
    return;
  }

  const token = authHeader.substring(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as JwtPayload;
    (req as any).user = decoded;
    next();
  } catch (err: any) {
    if (err.name === 'TokenExpiredError') {
      res.status(401).json({ error: 'Token expired. Please login again.' });
    } else {
      res.status(401).json({ error: 'Invalid authentication token.' });
    }
  }
}

/**
 * Middleware: Verify that the authenticated user has access
 * to the requested businessId (from X-Business-ID header).
 * Must be applied AFTER both authMiddleware and tenantMiddleware.
 * 
 * Admins bypass this check; agents/viewers must have the
 * businessId listed in their JWT businessIds array.
 */
export function tenantAuthorizationMiddleware(req: TenantRequest, res: Response, next: NextFunction): void {
  const user = (req as any).user as JwtPayload | undefined;
  
  if (!user) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  // Admins can access any business
  if (user.role === 'admin') {
    return next();
  }

  const businessId = req.businessId;
  if (!businessId) {
    return next(); // tenantMiddleware will catch missing businessId
  }

  if (!user.businessIds.includes(businessId)) {
    res.status(403).json({ error: 'Access denied. You do not have permission for this business.' });
    return;
  }

  next();
}

/**
 * Generate a JWT token for a user.
 * Used by login/auth endpoints.
 */
export function generateToken(payload: Omit<JwtPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRY } as jwt.SignOptions);
}

/**
 * Verify and decode a JWT token without middleware context.
 * Useful for WebSocket auth or background job auth.
 */
export function verifyToken(token: string): JwtPayload | null {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    return null;
  }
}

/**
 * Role-based access control middleware factory.
 * Usage: router.use(requireRole('admin', 'agent'));
 */
export function requireRole(...allowedRoles: JwtPayload['role'][]) {
  return (req: TenantRequest, res: Response, next: NextFunction): void => {
    const user = (req as any).user as JwtPayload | undefined;
    
    if (!user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }

    if (!allowedRoles.includes(user.role)) {
      res.status(403).json({ error: `Insufficient role. Required: ${allowedRoles.join(' or ')}` });
      return;
    }

    next();
  };
}
