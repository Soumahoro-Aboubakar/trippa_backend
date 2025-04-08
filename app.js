import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';

// Configuration
import { connectDB } from './config/database.js';
import { setupBackblaze } from './config/backblaze.js';

// Middlewares
import authMiddleware from './middlewares/authMiddleware.js';
import locationMiddleware from './middlewares/locationMiddleware.js';
import { errorHandler } from './utils/errorHandler.js';

// Routes
import userRoutes from './routes/userRoutes.js';
import messageRoutes from './routes/messageRoutes.js';
import groupRoutes from './routes/groupRoutes.js';
import alertRoutes from './routes/alertRoutes.js';
import businessRoutes from './routes/businessRoutes.js';
import eventRoutes from './routes/eventRoutes.js';
import statusRoutes from './routes/statusRoutes.js';
import paymentRoutes from './routes/paymentRoutes.js';
import notificationRoutes from './routes/notificationRoutes.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialiser l'application Express
const app = express();

// Connexion à la base de données
connectDB();

// Configurer Backblaze
setupBackblaze();

// Middlewares
app.use(cors());
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routes publiques
app.use('/api/users/auth', userRoutes);

// Middleware d'authentification pour les routes protégées
app.use('/api', authMiddleware);

// Routes protégées
app.use('/api/users', userRoutes);
app.use('/api/messages', messageRoutes);
app.use('/api/groups', groupRoutes);
app.use('/api/alerts', alertRoutes);
app.use('/api/businesses', businessRoutes);
app.use('/api/events', eventRoutes);
app.use('/api/status', statusRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/notifications', notificationRoutes);

// Dossier statique pour les médias
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Route racine
app.get('/', (req, res) => {
  res.send('API de l\'application de messagerie en temps réel');
});

// Middleware de gestion des erreurs
app.use(errorHandler);

export default app;