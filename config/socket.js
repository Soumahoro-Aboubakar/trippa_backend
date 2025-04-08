import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import User from '../models/user.model.js';
import dotenv from 'dotenv';

dotenv.config();
const configureSocket = (server) => {
    const io = new Server(server, {
        cors: {
            origin: process.env.CLIENT_URL || "*",
            methods: ["GET", "POST"],
            credentials: true
        },
        pingTimeout: 60000
    });

    // Middleware d'authentification Socket.io
    io.use(async (socket, next) => {
        try {
            const token = socket.handshake.auth.token;
            if (!token) {
                return next(new Error('Authentification requise'));
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            const user = await User.findById(decoded.id);

            if (!user) {
                return next(new Error('Utilisateur non trouvé'));
            }

            socket.user = {
                id: user._id,
                userPseudo: user.userPseudo
            };

            next();
        } catch (error) {
            return next(new Error('Authentification non valide'));
        }
    });

    return io;
};

export default configureSocket;
