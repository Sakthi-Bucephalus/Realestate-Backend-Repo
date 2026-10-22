const mongoose = require('mongoose');

let memoryServerInstance = null;

const connectDB = async () => {
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/estateflow';

  try {
    console.log('[Database] Connecting to MongoDB at:', uri.replace(/:([^@]+)@/, ':****@'));
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 5000,
    });
    console.log('[Database] Successfully connected to primary MongoDB database.');
  } catch (err) {
    console.warn('[Database] Primary MongoDB connection failed:', err.message);
    console.log('[Database] Starting resilient embedded MongoDB instance for seamless operation...');

    try {
      const { MongoMemoryServer } = require('mongodb-memory-server');
      memoryServerInstance = await MongoMemoryServer.create();
      const memUri = memoryServerInstance.getUri();
      console.log('[Database] Resilient local MongoDB instance created at:', memUri);
      await mongoose.connect(memUri);
      console.log('[Database] Successfully connected to resilient local embedded database.');
    } catch (memErr) {
      console.error('[Database] Fatal: Unable to initialize embedded MongoDB:', memErr.message);
      throw memErr;
    }
  }

  mongoose.connection.on('error', (err) => {
    console.error('[Database] Runtime connection error:', err.message);
  });
};

const disconnectDB = async () => {
  await mongoose.disconnect();
  if (memoryServerInstance) {
    await memoryServerInstance.stop();
  }
};

module.exports = {
  connectDB,
  disconnectDB,
};
