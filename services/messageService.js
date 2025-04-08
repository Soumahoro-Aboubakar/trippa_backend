// services/messageService.js
import mongoose from 'mongoose';
import Message from '../models/message.model.js';

/**
 * Récupère les messages non lus pour un utilisateur dans ses rooms
 * @param {string} userId - ID de l'utilisateur
 * @param {Array} userRooms - Liste des IDs des rooms de l'utilisateur
 * @returns {Promise<Array>} - Liste des messages non lus
 */
export const getUnreadMessages = async (userId, userRooms) => {
    try {
        // Validation des entrées
        if (!userId || !userRooms || !userRooms.length) {
            return [];
        }

        // Conversion des IDs en ObjectId
        const roomIds = userRooms.map(id => new mongoose.Types.ObjectId(String(id)));

        // Pipeline d'agrégation optimisé
        const aggregationPipeline = [
            {
                $match: {
                    room: { $in: roomIds },
                    receivedBy: { $nin: [userId] }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'sender',
                    foreignField: '_id',
                    as: 'sender',
                    pipeline: [{
                        $project: {
                            wallet: 0,
                            phone: 0,
                            email: 0
                        }
                    }]
                }
            },
            { $unwind: '$sender' },
            {
                $lookup: {
                    from: 'rooms',
                    localField: 'room',
                    foreignField: '_id',
                    as: 'room',
                    pipeline: [{
                        $match: {
                            $expr: {
                                $or: [
                                    { $eq: ["$isGroup", true] },
                                    {
                                        $and: [
                                            { $eq: ["$isGroup", true] },
                                            { $in: [userId, "$members"] }
                                        ]
                                    }
                                ]
                            }
                        }
                    }]
                }
            },
            {
                $unwind: {
                    path: '$room',
                    preserveNullAndEmptyArrays: false
                }
            },
            {
                $project: {
                    'sender.profile.profileViewers': 0,
                    'sender.profile.statusViewers': 0,
                    'sender.statusShared': 0,
                    'room.members': 0,
                    'room.wallet': 0,
                    receivedBy: 0,
                    seenBy: 0
                }
            },
            {
                $sort: {
                    createdAt: 1,
                    'room.lastActivity': -1
                }
            },
            { $limit: 100 }
        ];

        const userMessages = await Message.aggregate(aggregationPipeline);
        return userMessages;
    } catch (error) {
        console.error('Erreur lors de la récupération des messages non lus:', error);
        return [];
    }
};


/*
const getUnreadMessages = async (userId, userRooms) => {
    try {
        // Conversion des IDs en ObjectId
        const roomIds = userRooms.map(id => new mongoose.Types.ObjectId(String(id)));

        // Pipeline optimisé
        const aggregationPipeline = [
            {
                $match: {
                    room: { $in: roomIds }, // Filtre sur toutes les rooms de l'utilisateur
                    receivedBy: { $nin: [userId] }
                }
            },
            {
                $lookup: {
                    from: 'users',
                    localField: 'sender',
                    foreignField: '_id',
                    as: 'sender',
                    pipeline: [{ $project: { wallet: 0, phone: 0, email: 0 } }] // Optimisation directe dans le lookup
                }
            },
            { $unwind: '$sender' },
            {
                $lookup: {
                    from: 'rooms',
                    localField: 'room',
                    foreignField: '_id',
                    as: 'room',
                    pipeline: [{
                        $match: {
                            $expr: {
                                $or: [
                                    { $eq: ["$isGroup", true] }, // Sélectionne uniquement les groupes
                                    {
                                        $and: [
                                            { $eq: ["$isGroup", true] },
                                            { $in: [userId, "$members"] } // Vérifie si l'utilisateur appartient au groupe
                                        ]
                                    }
                                ]
                            }
                        }
                    }]

                }
            },
            { $unwind: { path: '$room', preserveNullAndEmptyArrays: false } },
            {
                $project: {
                    'sender.profile.profileViewers': 0,
                    'sender.profile.statusViewers': 0,
                    'sender.statusShared': 0,
                    'room.members': 0,
                    'room.wallet': 0,
                    receivedBy: 0,
                    seenBy: 0
                }
            },
            {
                $sort: {
                    createdAt: 1, // Tri ascendant pour récupérer l'ordre chronologique
                    'room.lastActivity': -1 // Tri supplémentaire si nécessaire
                }
            },
            { $limit: 100 } // Sécurité contre les résultats trop volumineux
        ];

        const userMessages = await Message.aggregate(aggregationPipeline);
        console.log(userMessages, "  userMessages")
        return userMessages;

    } catch (error) {
        console.error('Error:', error);
        return [];
    }
};  */