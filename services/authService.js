// services/authService.js
import jwt from 'jsonwebtoken';
import User from '../models/user.model.js';
import { generateRefreshToken, generateToken } from '../controllers/userController.js';
import dotenv from 'dotenv';

dotenv.config();
/**
 * Vérifie la validité d'un token JWT
 * @param {string} token - Le token JWT à vérifier
 * @returns {Promise} - Promesse résolue avec le payload décodé ou rejetée avec une erreur
 */
export const verifyToken = (token) => {
    return new Promise((resolve, reject) => {
        jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
            if (err) {
                reject(err);
            } else {
                resolve(decoded);
            }
        });
    });
};

/**
 * Rafraîchit le token d'un utilisateur
 * @param {Object} data - Les données de rafraîchissement (refreshToken, deviceId, userId)
 * @returns {Promise<Object>} - Résultat avec nouveaux tokens ou erreur
 */
export const refreshUserToken = async (data) => {
    //il existe deux types de tokens : accessToken et refreshToken (permet de reactiver un accessToken expiré)
    const { refreshToken, deviceId, userId } = data;

    // Validation des données d'entrée
    if (!refreshToken || !deviceId || !userId) {
        return { error: { code: 400, message: "Paramètres manquants" } };
    }

    try {
        // Récupération des données utilisateur
        const userData = await User.findOne({ _id: userId });
        if (!userData) {
            return { error: { code: 404, message: "Utilisateur non trouvé" } };
        }

        // Vérification du token de rafraîchissement
        const refreshTokens = userData.refreshTokens || [];
        const tokenData = refreshTokens.find(token => token.deviceId === deviceId);

        return new Promise((resolve) => {
            jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET, async (err, user) => {
                if (err) {
                    // Gestion des tokens expirés
                    if (err.name === "TokenExpiredError") {
                        if (!tokenData) {
                            return resolve({ error: { code: 401, message: "Token expiré" } });
                        }

                        // Mise à jour du refresh token
                        const updatedRefreshTokens = refreshTokens.filter(token => token.deviceId !== deviceId);
                        const newRefreshToken = generateRefreshToken(userId);

                        userData.refreshTokens = [...updatedRefreshTokens, { deviceId, token: newRefreshToken }];
                        await userData.save();
                        // Génération d'un nouveau token d'accès
                        const newAccessToken = generateToken(userData._id);
                        return resolve({ tokens: { refreshToken: newRefreshToken, accessToken: newAccessToken } });
                    } else {
                        return resolve({ error: { code: 403, message: "Token invalide" } });
                    }
                }

                // Vérification des données du token
                if (!tokenData) {
                    return resolve({ error: { code: 403, message: "Token non reconnu" } });
                }

                // Génération d'un nouveau token d'accès
                const newAccessToken = generateToken(userData._id);
                resolve({ tokens: { accessToken: newAccessToken } });
            });
        });
    } catch (error) {
        console.error('Erreur lors du rafraîchissement du token:', error);
        return { error: { code: 500, message: "Erreur serveur" } };
    }
};