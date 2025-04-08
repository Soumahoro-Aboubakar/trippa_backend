import { postFile } from '../config/backblaze.js';
import User from '../models/user.model.js';
import { findNearbyUsers, updateUserLocation } from '../services/geoService.js';
import { storeMedia } from '../services/mediaService.js';
import { isUserOnline } from '../services/socketService.js';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
import twilio from 'twilio';
const client = twilio(process.env.ACCOUNT_SID, process.env.AUTH_TOKEN_TWILIO);
function generateCode() {
    return Math.floor(100000 + Math.random() * 900000); // exemple : 472193
}
dotenv.config();


const sendVerificationCode = async (toPhoneNumber, code) => {
    const message = `Votre code de vérification est : ${code}`;
  console.log(process.env.MESSAGE_SERVICE_SID , " messagingServiceSid ", toPhoneNumber, " toPhoneNumber ", message, " message ");
  
    try {
        const sms = await client.messages.create({
            body: message,
            to: toPhoneNumber,
            messagingServiceSid: process.env.MESSAGE_SERVICE_SID, // 
            from: ''
        });
        return code;
    } catch (error) {
        console.error('❌ Erreur lors de l\'envoi du SMS :', error.message);
        throw error;
    }
}


const generateUniqueKSD = async () => {
    let isUnique = false;
    let ksd = '';

    while (!isUnique) {
        // Générer un KSD aléatoire entre 3 et 5 caractères
        const length = Math.floor(Math.random() * 3) + 3; // 3, 4, ou 5
        const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
        ksd = '';

        for (let i = 0; i < length; i++) {
            ksd += chars.charAt(Math.floor(Math.random() * chars.length));
        }

        // Vérifier que ce KSD n'existe pas déjà
        const existingUser = await User.findOne({ KSD: ksd });
        if (!existingUser) {
            isUnique = true;
        }
    }

    return ksd;
};
export const generateRefreshToken = (userId) => {
    return jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, { expiresIn: "30d" });
};
export const generateToken = (userId) => {
    return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: process.env.TOKEN_EXPIRATION });
}
/**
 * Crée un nouvel utilisateur et envoie un SMS de vérification
 * @param {Object} socket - Socket.io socket
 * @param {Object} userData - Données de l'utilisateur
 * @param {string} userData.userPseudo - Pseudo de l'utilisateur
 * @param {string} userData.phone - Numéro de téléphone
 * @param {string} userData.email - Email de l'utilisateur
 * @param {Object} userData.location - Données de localisation
 */



export const createUser = async (socket, userData) => {
    try {
        const { userPseudo, phone } = userData;

        if (!phone || typeof phone !== 'string') {
            socket.emit('user:error', { message: 'Le numéro de téléphone est requis et doit être valide.' });
            return;
        }

        const trimmedPhone = phone.trim();
        const code = generateCode();
        const now = new Date();

        let user = await User.findOne({ phone: trimmedPhone });

        if (user) {
            user.verifyCode = {
                code,
                createdAt: now
            };
            await user.save();
        } else {
            const KSD = await generateUniqueKSD();

            user = new User({
                userPseudo: userPseudo || '',
                phone: trimmedPhone,
                KSD,
                verifyCode: {
                    code,
                    createdAt: now
                }
            });

            await user.save();
        }

        await sendVerificationCode(trimmedPhone, code);

        socket.userData = {
            _id: user._id,
        };

        // 📤 7. Réponse au client
        socket.emit('verification:sent', {
            message: 'Un code de vérification a été envoyé à votre numéro de téléphone.',
        });

    } catch (error) {
        console.error('❌ Erreur lors de la création de l\'utilisateur :', error);
        socket.emit('user:error', {
            message: 'Une erreur est survenue lors de la création de l\'utilisateur. Veuillez réessayer.'
        });
    }
};


/**
 * Vérifie le code SMS et finalise la création de l'utilisateur
 * @param {Object} socket - Socket.io socket
 * @param {string} code - Code de vérification SMS
 */
export const verifyUserSMS = async (socket, code, deviceId) => {

    try {
        if (!socket.userData._id || !code) {
            socket.emit('verification:error', { message: 'Session expirée, veuillez recommencer' });
            return;
        }

        const user = await User.findById(socket.userData._id);
        if (!user) {
            socket.emit('verification:error', { code: 403, message: 'Utilisateur non trouvé' });
            return;
        }

        if (code !== user.verifyCode.code) {
            socket.emit('verification:error', { code: 401, message: 'Code de vérification incorrect' });
            return;
        } else {
            const expirationTime = 5 * 60 * 1000; // 5 minutes
            const isExpired = new Date() - user.verifyCode.createdAt > expirationTime;
            if (isExpired) {
                socket.emit('verification:error', { code: 402, message: 'Le code de vérification a expiré' });
                return;
            }
        }
        socket.userData = {
            ...user.toObject(),
        };
        const token = generateToken(socket.userData._id);
        const refreshToken = generateRefreshToken(socket.userData._id);
        user.refreshTokens.push({ deviceId, token: refreshToken });
        await user.save();
        socket.emit('user:created', {
            message: 'Votre compte a été créé avec succès',
            token: token,
            refreshToken: refreshToken,
        });

    } catch (error) {
        console.error('Erreur lors de la vérification SMS:', error);
        socket.emit('verification:error', { message: 'Une erreur est survenue lors de la vérification' });
    }
};

export const  resendSmsVerificationCode = async (socket , phone) => {
    try {
        if (!phone || typeof phone !== 'string') {
            socket.emit('verification:error',  {code: 401, message: 'Le numéro de téléphone est requis et doit être valide.' });
            return;
        }
        const trimmedPhone = phone.trim();
        const user = await User.findOne({ phone: trimmedPhone });

        if (!user) {
            socket.emit('verification:error', { code: 403, message: 'Utilisateur non trouvé, veuillez vérifier votre numéro de téléphone. Si le numéro est correct, veuillez contacter nous laisser un message.' });
            return;
        }

        const code = generateCode();
        const now = new Date();

        user.verifyCode = {
            code,
            createdAt: now
        };
        await user.save();

        await sendVerificationCode(user.phone, code);

        socket.emit('verification:sent', {
            message: 'Un nouveau code de vérification a été envoyé à votre numéro de téléphone.',
        });

    } catch (error) {
        console.error('Erreur lors de la réinitialisation du code SMS:', error);
        socket.emit('verification:error', { message: 'Une erreur est survenue lors de la réinitialisation du code' });
    }
}


// Obtenir le profil utilisateur
export const getUserProfile = async (socket, userId) => {
    try {
        const filterData = userId === socket.userData._id ? '' : '-wallet -phone -email -phone -location -lastLocation -profile.profileViewers -profile.statusViewers -statusShared';

        const user = await User.findById(userId)
            .select(filterData);

        if (!user) {
            socket.emit('user:profile_error', {
                status: 404,
                message: 'Utilisateur non trouvé'
            });
            return;
        }

        // Récupération de l'ID du visiteur depuis les données d'authentification
        const viewerId = socket.userData?._id;

        // Mise à jour des viewers seulement si c'est un visiteur différent
        if (viewerId && viewerId !== userId?.toString()) {

            const updateOperation =
            {
                $push: {
                    "profile.profileViewers": {
                        userId: viewerId,
                        viewedAt: new Date()
                    }
                }
            };

            await User.updateOne(
                { _id: userId },
                updateOperation,
                { new: true }
            );
        }

        // Préparation de la réponse avec statut en ligne
        const userResponse = user.toObject();
        userResponse.isOnline = isUserOnline(user._id);

        socket.emit('user:profile', userResponse);

    } catch (error) {
        console.error('Erreur lors de la récupération du profil utilisateur:', error);
        socket.emit('user:profile_error', {
            status: 500,
            message: 'Erreur serveur'
        });
    }
};

// Mettre à jour le profil utilisateur
export const updateUserProfile = async (socket, updateData) => {
    try {
        const { bio, interests, isShyMode, visibility, photo, originalname, mimetype } = updateData;
        const updatePayload = {
            'profile.bio': bio,
            'profile.interests': interests,
            'profile.isShyMode': isShyMode,
            'profile.visibility': visibility
        };

        // Gestion de la photo (base64 ou URL)
        if (photo) {
            try {
                const imageBuffer = Buffer.from(photo, 'base64');
                let file = {
                    buffer: imageBuffer,
                    originalname: originalname ?? 'profile.jpg',
                    mimetype: mimetype ?? 'image/jpeg'
                };
                let result = await postFile(file);
                updatePayload['profile.photo'] = result.fileId;
            } catch (uploadError) {
                console.error('Erreur upload photo:', uploadError);
                socket.emit('profile:update_error', {
                    status: 500,
                    message: 'Échec de l\'upload de la photo'
                });
                return;
            }
        }

        // Mise à jour atomique avec validation
        const updatedUser = await User.findByIdAndUpdate(
            socket.userData._id, // ID récupéré de l'authentification
            { $set: updatePayload },
            {
                new: true,
                runValidators: true,
                projection: { 'profile': 1 } // Ne retourne que le profil
            }
        ).lean();

        // Diffusion de la mise à jour
        socket.emit('profile:updated', updatedUser.profile);
        /* 
                // Optionnel : notifier les autres clients connectés
                socket.broadcast.emit('profile:updated_global', {
                    userId: socket.userData._id,
                    profile: updatedUser.profile
                }); */

    } catch (error) {
        console.error('Erreur mise à jour profil:', error);

        const errorMessage = error.name === 'ValidationError'
            ? 'Données de profil invalides'
            : 'Erreur serveur';

        socket.emit('profile:update_error', {
            status: error.statusCode || 500,
            message: errorMessage,
            details: error.errors // Optionnel pour le débogage
        });
    }
};



// Trouver des utilisateurs à proximité (version Socket.io)
export const getNearbyUsers = async (socket, data) => {
    try {
        const { radius = 1000 } = data;

        // Récupérer l'utilisateur connecté depuis les informations du socket
        const currentUser = await User.findById(socket.userData._id);
        if (!currentUser?.location?.coordinates) {
            socket.emit('nearby-users:error', {
                message: 'Position de l\'utilisateur non disponible'
            });
            return;
        }

        // Recherche des utilisateurs proches
        const nearbyUsers = await findNearbyUsers(
            currentUser.location.coordinates,
            Number(radius),
            socket.userData._id
        );

        // Filtrage selon la visibilité
        const filteredUsers = nearbyUsers.filter(user =>
            user.profile?.visibility === 'public'
        );

        // Ajout du statut en ligne
        const usersWithStatus = filteredUsers.map(user => ({
            ...user.toObject(),
            isOnline: isUserOnline(user._id)
        }));

        socket.emit('nearby-users:result', usersWithStatus);
    } catch (error) {
        console.error('Erreur récupération utilisateurs proches:', error);
        socket.emit('nearby-users:error', { message: 'Erreur serveur' });
    }
};

// Mettre à jour la position (version Socket.io)
export const updateLocation = async (socket, data) => {
    try {
        const { coordinates, address } = data;
        // Validation des coordonnées
        if (!coordinates || !Array.isArray(coordinates) || coordinates.length !== 2) {
            socket.emit('location:error', {
                message: 'Coordonnées invalides'
            });
            return;
        }

        // Mise à jour en base
        const updatedUser = await updateUserLocation(
            socket.userData._id,
            coordinates,
            address
        );

        // Envoi de la confirmation  
        socket.emit('location:updated', {
            location: updatedUser.location,
            lastLocation: updatedUser.lastLocation
        });
    } catch (error) {
        console.error('Erreur mise à jour localisation:', error);
        socket.emit('location:error', { message: 'Erreur serveur' });
    }
};