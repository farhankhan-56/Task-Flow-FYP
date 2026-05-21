const express = require('express');
const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const { query } = require('../db');

const router = express.Router();

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const googleCallbackUrl = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/auth/google/callback';

if (!googleClientId || !googleClientSecret) {
  console.warn('[google-auth] Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET in .env. Google login will not work.');
} else {
  passport.use(new GoogleStrategy(
    {
      clientID: googleClientId,
      clientSecret: googleClientSecret,
      callbackURL: googleCallbackUrl
    },
    async (accessToken, refreshToken, profile, done) => {
    try {
      const emailObj = profile.emails?.find((item) => item?.value?.includes('@'));
      const email = emailObj?.value?.toLowerCase().trim();
      if (!email) {
        return done(new Error('Google account did not return a valid email.'));
      }

      const googleId = profile.id;
      const name = profile.displayName || email.split('@')[0];
      const picture = profile.photos?.[0]?.value || null;

      const existingByGoogle = await query(
        'SELECT id, name, email, google_id, profile_picture FROM users WHERE google_id = $1 LIMIT 1',
        [googleId]
      );
      if (existingByGoogle.rows.length > 0) {
        const user = existingByGoogle.rows[0];
        return done(null, {
          id: String(user.id),
          name: user.name,
          email: user.email,
          profile_picture: user.profile_picture
        });
      }

      const existingByEmail = await query(
        'SELECT id, name, email, google_id, profile_picture FROM users WHERE email = $1 LIMIT 1',
        [email]
      );
      if (existingByEmail.rows.length > 0) {
        const row = existingByEmail.rows[0];
        const userId = String(row.id);
        await query(
          'UPDATE users SET google_id = $1, profile_picture = $2, name = $3, email_verified = TRUE WHERE id = $4',
          [googleId, picture, name, userId]
        );
        return done(null, { id: userId, name, email, profile_picture: picture });
      }

      const insertResult = await query(
        `INSERT INTO users (name, email, google_id, profile_picture, auth_type, email_verified)
         VALUES ($1, $2, $3, $4, 'google', TRUE)
         RETURNING id, name, email, profile_picture`,
        [name, email, googleId, picture]
      );
      const newUser = insertResult.rows[0];
      return done(null, {
        id: String(newUser.id),
        name: newUser.name,
        email: newUser.email,
        profile_picture: newUser.profile_picture
      });
    } catch (err) {
      console.error('[google-auth] Error handling Google profile:', err);
      return done(err);
    }
  }
));
}

passport.serializeUser((user, done) => done(null, user));
passport.deserializeUser((obj, done) => done(null, obj));

const googleAuthEnabled = Boolean(googleClientId && googleClientSecret);

router.get('/google', (req, res, next) => {
  if (!googleAuthEnabled) {
    return res.status(500).send('Google login is not configured.');
  }
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    prompt: 'select_account'
  })(req, res, next);
});

router.get('/google/callback', (req, res, next) => {
  if (!googleAuthEnabled) {
    return res.redirect('/index.html?google_error=1');
  }
  passport.authenticate('google', { failureRedirect: '/index.html', session: false }, (err, user) => {
    if (err || !user) {
      console.error('[google-auth/callback] Authentication failed:', err);
      return res.redirect('/index.html?google_error=1');
    }
    req.session.user = user;
    res.redirect('/dashboard.html');
  })(req, res, next);
});

module.exports = router;
