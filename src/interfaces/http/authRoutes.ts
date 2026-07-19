import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { TenantRequest } from './types';
import { generateToken } from '../middleware/auth';
import { validateBody, LoginSchema, RegisterSchema } from '../middleware/validation';
import { pool } from '../../infrastructure/database/database';

// ══════════════════════════════════════════════════════════════
//  AUTH ROUTES
//  Handles user registration, login, and token generation.
//  Users are stored in a `users` table with hashed passwords.
// ══════════════════════════════════════════════════════════════

const router = Router();

/**
 * POST /api/auth/register
 * Create a new user account.
 */
router.post('/register', validateBody(RegisterSchema), async (req: TenantRequest, res: Response) => {
  const { email, password, name, role } = req.body;

  try {
    // Check if user already exists
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'A user with this email already exists.' });
    }

    // Hash password
    const salt = await bcrypt.genSalt(12);
    const passwordHash = await bcrypt.hash(password, salt);

    // Insert user
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, role) 
       VALUES ($1, $2, $3, $4) RETURNING id, email, name, role, created_at`,
      [email.toLowerCase(), passwordHash, name, role || 'agent']
    );

    const user = result.rows[0];

    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      businessIds: [], // no businesses assigned yet
    });

    res.status(201).json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
      token,
    });
  } catch (err: any) {
    console.error('[Auth] Registration error:', err.message);
    res.status(500).json({ error: 'Registration failed.' });
  }
});

/**
 * POST /api/auth/login
 * Authenticate user and return JWT token.
 */
router.post('/login', validateBody(LoginSchema), async (req: TenantRequest, res: Response) => {
  const { email, password } = req.body;

  try {
    // Find user by email
    const result = await pool.query(
      'SELECT id, email, password_hash, name, role FROM users WHERE email = $1',
      [email.toLowerCase()]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const user = result.rows[0];

    // Verify password
    const isValid = await bcrypt.compare(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    // Fetch assigned businesses
    const bizResult = await pool.query(
      'SELECT business_id FROM user_businesses WHERE user_id = $1',
      [user.id]
    );
    const businessIds = bizResult.rows.map((r: any) => r.business_id);

    // Generate JWT token
    const token = generateToken({
      userId: user.id,
      email: user.email,
      role: user.role,
      businessIds,
    });

    // Update last login
    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    res.json({
      user: { id: user.id, email: user.email, name: user.name, role: user.role, businessIds },
      token,
    });
  } catch (err: any) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({ error: 'Login failed.' });
  }
});

/**
 * GET /api/auth/me
 * Return current user info from JWT token.
 */
router.get('/me', async (req: TenantRequest, res: Response) => {
  const user = (req as any).user;
  if (!user) {
    return res.status(401).json({ error: 'Not authenticated.' });
  }

  try {
    const result = await pool.query(
      'SELECT id, email, name, role, created_at, last_login FROM users WHERE id = $1',
      [user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Fetch assigned businesses
    const bizResult = await pool.query(
      `SELECT b.id, b.name, b.wa_phone_number, b.subscription_plan, b.status 
       FROM businesses b
       INNER JOIN user_businesses ub ON b.id = ub.business_id
       WHERE ub.user_id = $1`,
      [user.userId]
    );

    res.json({
      ...result.rows[0],
      businesses: bizResult.rows,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
