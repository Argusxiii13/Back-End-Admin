const express = require('express');

module.exports = (deps) => {
  const router = express.Router();
  const { pool, dbPool, io, upload, sendEmailHandler, sendEmailNotif, sendEmailInvoice, generateInvoicePDF, notifyClient, notifyAdmin, emitAdminNotification, logAction, retryPgOperation, validatePassword, bcrypt, crypto, otps, nodemailer, axios } = deps;

router.get('/api/admin/fleet/fleet-table', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  const pool = dbPool;

  try {
      const result = await pool.query('SELECT * FROM cars_view');
      const cars = result.rows;
      res.json(cars);
  } catch (error) {
      console.error('Error fetching car data:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});


router.get('/api/admin/fleet/statistics', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  const pool = dbPool;

  try {
      const totalVehiclesResult = await pool.query('SELECT COUNT(*) AS total_vehicles FROM cars_view');
      const totalVehicles = totalVehiclesResult.rows[0].total_vehicles;

      const mostRentedResult = await pool.query(`
          SELECT c.plate_num AS most_rented_vehicle, 
                 COUNT(b.car_id) AS rental_count, 
                 c.created_at
          FROM cars_view c
          JOIN bookings_view b ON c.id::text = b.car_id  -- Cast c.id to text
          GROUP BY c.id, c.plate_num, c.created_at
          HAVING COUNT(b.car_id) = (
              SELECT MAX(rental_count)
              FROM (
                  SELECT COUNT(*) AS rental_count 
                  FROM bookings_view 
                  GROUP BY car_id
              ) AS rental_counts
          )
          ORDER BY c.created_at DESC
          LIMIT 1
      `);
      const mostRentedVehicle = mostRentedResult.rows[0]?.most_rented_vehicle || 'N/A';

      const leastRentedResult = await pool.query(`
          SELECT c.plate_num AS least_rented_vehicle, 
                 COALESCE(rc.rental_count, 0) AS rental_count, 
                 c.created_at
          FROM cars_view c
          LEFT JOIN (
              SELECT car_id, COUNT(*) AS rental_count 
              FROM bookings_view 
              GROUP BY car_id
          ) rc ON c.id::text = rc.car_id  -- Cast c.id to text
          WHERE rc.rental_count IS NULL OR rc.rental_count = 0
          ORDER BY rental_count ASC, c.created_at ASC
          LIMIT 1
      `);
      const leastRentedVehicle = leastRentedResult.rows[0]?.least_rented_vehicle || 'N/A';

      res.json({
          totalVehicles: totalVehicles.toLocaleString(),
          mostRentedVehicle,
          leastRentedVehicle
      });
  } catch (error) {
      console.error('Error fetching fleet statistics:', error);
      res.status(500).json({ 
          error: 'Internal server error', 
          details: error.message 
      });
  }
});


router.get('/api/admin/fleet/booking-stats', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  const pool = dbPool;

  try {
      const totalBookingsResult = await pool.query('SELECT COUNT(*) AS total_bookings FROM bookings_view');
      const totalBookings = totalBookingsResult.rows[0].total_bookings;

      const bookingStatusResult = await pool.query(`
          SELECT status, COUNT(*) AS count 
          FROM bookings_view 
          GROUP BY status
      `);

      const monthlyBookingsResult = await pool.query(`
          SELECT 
              TO_CHAR(pickup_date, 'YYYY-MM') AS month, 
              COUNT(*) AS booking_count 
          FROM bookings_view 
          GROUP BY month 
          ORDER BY month
      `);

      res.json({
          totalBookings,
          statusDistribution: bookingStatusResult.rows,
          monthlyTrend: monthlyBookingsResult.rows
      });
  } catch (error) {
      console.error('Error fetching booking statistics:', error);
      res.status(500).json({ 
          error: 'Internal server error', 
          details: error.message 
      });
  }
});


router.get('/api/admin/fleet/vehicle-details/:id', async (req, res) => {
  const { id } = req.params;
  const { role } = req.query; // Get the role from the query parameters

  const pool = dbPool;

  try {
      const vehicleQuery = 'SELECT * FROM cars_view WHERE id = $1';
      const vehicleResult = await pool.query(vehicleQuery, [id]);
      
      if (vehicleResult.rows.length === 0) {
          return res.status(404).json({ error: 'Vehicle not found' });
      }
      
      const vehicle = vehicleResult.rows[0];
      
      const responseData = {
          ...vehicle,
          image: vehicle.image ? Buffer.from(vehicle.image).toString('base64') : null
      };

      res.json(responseData);
  } catch (error) {
      console.error('Error fetching vehicle details:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});


router.get('/api/admin/fleet/dropdowns-value', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  const pool = dbPool;

  try {
      const brandsResult = await pool.query('SELECT DISTINCT brand AS text FROM cars_view');
      const modelsResult = await pool.query('SELECT DISTINCT model AS text FROM cars_view');
      const transmissionsResult = await pool.query('SELECT DISTINCT transmission AS text FROM cars_view');
      const typesResult = await pool.query('SELECT DISTINCT type AS text FROM cars_view');

      const responseData = {
          brands: brandsResult.rows,
          models: modelsResult.rows,
          transmissions: transmissionsResult.rows,
          types: typesResult.rows
      };

      res.json(responseData);
  } catch (error) {
      console.error('Error fetching dropdown values:', error);
      res.status(500).json({ 
          error: 'Internal server error', 
          details: error.message 
      });
  }
});


router.post('/api/admin/fleet/add', async (req, res) => {
  const { 
      brand, 
      model, 
      type, 
      transmission, 
      price, 
      capacity, 
      luggage, 
      doors, 
      features, 
      description, 
      image, 
      plate_num,
      driver,
      admin_id, // Extract admin details
      admin_name,
      admin_role
  } = req.body;

  let imageBuffer = null;
  if (image) {
      imageBuffer = Buffer.from(image, 'base64');
  }

  const sql = `
      INSERT INTO cars (brand, model, type, transmission, price, 
                        capacity, luggage, doors, features, description, 
                        image, plate_num, driver)
      VALUES ($1, $2, $3, $4, $5, 
              $6, $7, $8, $9, $10, 
              $11, $12, $13)
      RETURNING id
  `;

  const values = [
      brand, 
      model, 
      type, 
      transmission, 
      price, 
      capacity, 
      luggage, 
      doors, 
      features, 
      description, 
      imageBuffer, 
      plate_num,
      driver
  ];
  const pool = dbPool;
  try {
      const result = await pool.query(sql, values);
      const platenum = result.rows[0].plate_num; // Get the inserted vehicle ID

      const action = `Added Car ${platenum}`;
      logAction(admin_id, admin_name, admin_role, action, {
          brand,
          model,
          type,
          transmission,
          price,
          capacity,
          luggage,
          doors,
          features,
          description,
          plate_num,
          driver
      });

      res.status(201).json({ 
          message: 'Car added successfully!',
      });
  } catch (error) {
      console.error('Error adding car:', error);
      res.status(500).json({ 
          message: 'Error adding car',
          error: error.message // Helpful for debugging, remove in production if needed
      });
  }
});


router.put('/api/admin/fleet/update/:id', async (req, res) => {

  const vehicleId = parseInt(req.params.id, 10);
  console.log(vehicleId); 
  const { 
      brand, 
      model, 
      type, 
      transmission, 
      price, 
      capacity, 
      luggage, 
      doors, 
      features, 
      description, 
      image, 
      plate_num,
      driver,
      admin_id, 
      admin_name,
      admin_role
  } = req.body;

  let imageBuffer = null;
  if (image) {
      imageBuffer = Buffer.from(image, 'base64');
  }

  const sql = `
      UPDATE cars 
      SET brand = $1, model = $2, type = $3, transmission = $4, price = $5, 
          capacity = $6, luggage = $7, doors = $8, features = $9, description = $10, 
          image = $11, plate_num = $12, driver = $13
      WHERE id = $14
      RETURNING *;  
  `;
  
  const values = [
    brand, 
    model, 
    type, 
    transmission, 
    price, 
    capacity, 
    luggage, 
    doors, 
    features, 
    description, 
    imageBuffer, 
    plate_num, 
    driver,
    vehicleId
  ];
  const pool = dbPool;
  try {
      const result = await pool.query(sql, values);
      const updatedCar = result.rows[0]; 


      const action = `Updated Car ${plate_num}`;
      logAction(admin_id, admin_name, admin_role, action, { car: updatedCar });

      res.status(200).json({ 
          message: 'Car updated successfully!',
          data: updatedCar 
      });
  } catch (error) {
      console.error('Error updating car:', error);
      console.log(req.params.id);
      res.status(500).json({ 
          message: 'Error updating car',
          error: error.message  
      });
  }
});


router.get('/api/admin/fleet/pie-chart', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  const pool = dbPool;

  try {
      const result = await pool.query(`
          SELECT 
              status,
              COUNT(*) AS count 
          FROM cars_view
          GROUP BY status
      `);

      const categoryData = result.rows.map(row => ({
          name: row.status,
          value: parseInt(row.count, 10),
      }));

      res.json(categoryData);
  } catch (error) {
      console.error('Error fetching fleet status distribution:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});


router.get('/api/admin/fleet/line-graph', async (req, res) => {
  const { role } = req.query; // Get the role from the query parameters

  const pool = dbPool;

  try {
      const result = await pool.query(`
          SELECT 
              c.brand,
              c.model,
              c.plate_num,  -- Include plate_num here
              DATE(b.created_at) AS created_at,
              SUM((b.return_date - b.pickup_date)) AS rental_days
          FROM bookings_view b
          JOIN cars_view c ON c.id = b.car_id
          GROUP BY c.brand, c.model, c.plate_num, DATE(b.created_at)
          ORDER BY created_at
      `);

      const rentalData = {};
      
      result.rows.forEach(row => {
          const date = row.created_at.toISOString().split('T')[0];
          const car = `${row.brand} ${row.plate_num}`;  // Use brand and plate_num
          const daysRented = parseInt(row.rental_days, 10);

          if (!rentalData[date]) {
              rentalData[date] = {};
          }
          rentalData[date][car] = (rentalData[date][car] || 0) + daysRented;
      });

      const responseData = [];
      for (const [date, cars] of Object.entries(rentalData)) {
          for (const [car, days] of Object.entries(cars)) {
              responseData.push({ date, car, rental_days: days });
          }
      }

      res.json(responseData);
  } catch (error) {
      console.error('Error fetching fleet rental data:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});


router.delete('/api/admin/fleet/fleet-table/:id', async (req, res) => {
  const { id } = req.params;
  const { role } = req.query; // Get the role from the query parameters

  const pool = dbPool;

  try {
      await pool.query('DELETE FROM cars_view WHERE id = $1', [id]);
      res.status(204).send(); // No content response for successful deletion
  } catch (error) {
      console.error('Error deleting car:', error);
      res.status(500).json({ error: 'Internal server error' });
  }
});

  return router;
};
