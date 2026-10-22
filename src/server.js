require('dotenv').config();
const http = require('http');
const cron = require('node-cron');
const app = require('./app');
const { connectDB, disconnectDB } = require('./config/db');
const { runPeriodicJobs } = require('./services/jobService');

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    // 1. Establish Resilient Database Connection
    await connectDB();

    // 1b. Auto-Bootstrap initial demo accounts if database is empty
    const { autoBootstrapIfEmpty } = require('./scripts/seed');
    await autoBootstrapIfEmpty();

    // 2. Start HTTP Server
    const server = http.createServer(app);

    server.listen(PORT, () => {
      console.log(`\n======================================================`);
      console.log(` EstateFlow Server running in ${process.env.NODE_ENV || 'development'} mode`);
      console.log(` API Endpoint: http://localhost:${PORT}`);
      console.log(` Health Check: http://localhost:${PORT}/api/health`);
      console.log(`======================================================\n`);
    });

    // 3. Start Durable Background Job Scheduler (Runs every 60 seconds)
    cron.schedule('* * * * *', async () => {
      try {
        await runPeriodicJobs();
      } catch (cronErr) {
        console.error('[Scheduler] Error executing periodic background tasks:', cronErr.message);
      }
    });
    console.log('[Scheduler] Durable reminder & email worker started (Interval: 60s)');

    // 4. Graceful Shutdown Handlers
    const handleShutdown = async (signal) => {
      console.log(`\n[Server] Received ${signal}. Gracefully shutting down...`);
      server.close(async () => {
        console.log('[Server] HTTP server closed.');
        await disconnectDB();
        console.log('[Database] Database connection closed.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));
  } catch (err) {
    console.error('[Server] Fatal startup error:', err.message);
    process.exit(1);
  }
};

startServer();
