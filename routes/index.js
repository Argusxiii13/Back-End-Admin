const adminsRoutes = require('./admins.routes');
const analyticsRoutes = require('./analytics.routes');
const authRoutes = require('./auth.routes');
const bookingsRoutes = require('./bookings.routes');
const dashboardRoutes = require('./dashboard.routes');
const feedbackRoutes = require('./feedback.routes');
const fleetRoutes = require('./fleet.routes');
const salesRoutes = require('./sales.routes');
const settingsRoutes = require('./settings.routes');
const usersRoutes = require('./users.routes');

module.exports = (app, deps) => {
  app.use(adminsRoutes(deps));
  app.use(analyticsRoutes(deps));
  app.use(authRoutes(deps));
  app.use(bookingsRoutes(deps));
  app.use(dashboardRoutes(deps));
  app.use(feedbackRoutes(deps));
  app.use(fleetRoutes(deps));
  app.use(salesRoutes(deps));
  app.use(settingsRoutes(deps));
  app.use(usersRoutes(deps));
};
