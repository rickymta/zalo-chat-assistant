/** Kết nối MongoDB qua Mongoose. Không nối được là DỪNG — API không có DB thì mọi route đều hỏng. */
import mongoose from 'mongoose';
import { config } from './config.js';

export async function connectDb() {
  mongoose.set('strictQuery', true);
  await mongoose.connect(config.mongoUrl, {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 20,
  });
  return mongoose.connection;
}

export async function closeDb() {
  await mongoose.connection.close();
}
