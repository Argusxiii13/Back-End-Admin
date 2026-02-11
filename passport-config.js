const LocalStrategy = require('passport-local').Strategy;
const bcrypt = require('bcrypt');

function initialize(passport, db) {
  const authenticateUser = async (email, password, done) => {
    try {
      const { rows: users } = await db.query('SELECT * FROM users WHERE email = $1', [email]); // Use $1 for parameterized queries
      const user = users[0];

      if (!user) {
        return done(null, false, { message: 'No user with that email' });
      }

      if (await bcrypt.compare(password, user.password)) {
        return done(null, user);
      } else {
        return done(null, false, { message: 'Password incorrect' });
      }
    } catch (error) {
      return done(error);
    }
  };

  passport.use(new LocalStrategy({ usernameField: 'email' }, authenticateUser));

  passport.serializeUser((user, done) => {
    done(null, user.id);
  });

  passport.deserializeUser(async (id, done) => {
    try {
      const { rows: users } = await db.query('SELECT * FROM users WHERE id = $1', [id]); // Use $1 for parameterized queries
      const user = users[0];
      done(null, user);
    } catch (error) {
      done(error);
    }
  });
}

module.exports = initialize;