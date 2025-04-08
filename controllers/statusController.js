import Status from '../models/Status.js';
import User from '../models/User.js';
import Business from '../models/Business.js';
import { uploadMedia, deleteMedia } from '../services/mediaService.js';
import mongoose from 'mongoose';
import { sendNearbyNotification } from '../services/notificationService.js';
import { getUsersInRadius } from '../services/geoService.js';

// Créer un nouveau statut
export const createStatus = async (req, res) => {
    try {
        const { creator, business, content, mediaType, isPromoted, promotionRadius } = req.body;
        let mediaUrl = null;

        // Gérer l'upload du média si présent
        if (req.file) {
            const uploadResult = await uploadMedia(req.file, 'status');
            mediaUrl = uploadResult.url;
        }

        // Vérifier que le créateur existe
        const user = await User.findById(creator);
        if (!user) {
            return res.status(404).json({ message: 'Utilisateur non trouvé' });
        }

        // Si c'est lié à un business, vérifier qu'il existe et appartient au créateur
        if (business) {
            const businessDoc = await Business.findById(business);
            if (!businessDoc) {
                return res.status(404).json({ message: 'Entreprise non trouvée' });
            }
            if (businessDoc.owner.toString() !== creator) {
                return res.status(403).json({ message: 'Vous n\'êtes pas autorisé à créer un statut pour cette entreprise' });
            }
        }

        const status = new Status({
            creator,
            business,
            content,
            mediaUrl,
            mediaType: mediaUrl ? mediaType : 'text',
            isPromoted,
            promotionRadius: promotionRadius || 1000
        });

        await status.save();

        // Si le statut est promu, envoyer des notifications aux utilisateurs à proximité
        if (isPromoted) {
            const location = business
                ? (await Business.findById(business)).location.coordinates
                : user.location.coordinates;

            const nearbyUsers = await getUsersInRadius(location, promotionRadius || 1000);

            for (const nearbyUser of nearbyUsers) {
                // Ne pas notifier le créateur
                if (nearbyUser._id.toString() === creator) continue;

                // Créer une notification pour chaque utilisateur à proximité
                await sendNearbyNotification({
                    recipient: nearbyUser._id,
                    sender: creator,
                    type: business ? 'business_nearby' : 'status_nearby',
                    title: business ? 'Nouveau statut d\'entreprise à proximité' : 'Nouveau statut à proximité',
                    message: business
                        ? `${(await Business.findById(business)).name} a publié un nouveau statut`
                        : `${user.userPseudo} a publié un nouveau statut`,
                    relatedEntity: {
                        entityType: 'Status',
                        entityId: status._id
                    }
                });
            }
        }

        res.status(201).json(status);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Récupérer un statut par ID
export const getStatusById = async (req, res) => {
    try {
        const status = await Status.findById(req.params.id)
            .populate('creator', 'userPseudo profile.photo')
            .populate('business', 'name description category photos');

        if (!status) {
            return res.status(404).json({ message: 'Statut non trouvé' });
        }

        res.status(200).json(status);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Récupérer les statuts d'un utilisateur
export const getUserStatuses = async (req, res) => {
    try {
        const { userId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const statuses = await Status.find({
            creator: userId,
            isActive: true,
            expiresAt: { $gt: new Date() }
        })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('creator', 'userPseudo profile.photo')
            .populate('business', 'name description category photos');

        const total = await Status.countDocuments({
            creator: userId,
            isActive: true,
            expiresAt: { $gt: new Date() }
        });

        res.status(200).json({
            statuses,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Récupérer les statuts d'une entreprise
export const getBusinessStatuses = async (req, res) => {
    try {
        const { businessId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        const statuses = await Status.find({
            business: businessId,
            isActive: true,
            expiresAt: { $gt: new Date() }
        })
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('creator', 'userPseudo profile.photo')
            .populate('business', 'name description category photos');

        const total = await Status.countDocuments({
            business: businessId,
            isActive: true,
            expiresAt: { $gt: new Date() }
        });

        res.status(200).json({
            statuses,
            totalPages: Math.ceil(total / limit),
            currentPage: page,
            total
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Récupérer les statuts à proximité
export const getNearbyStatuses = async (req, res) => {
    try {
        const { longitude, latitude, radius } = req.query;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;

        // Récupérer les statuts promus à proximité
        const businessStatuses = await Business.aggregate([
            {
                $geoNear: {
                    near: {
                        type: 'Point',
                        coordinates: [parseFloat(longitude), parseFloat(latitude)]
                    },
                    distanceField: 'distance',
                    maxDistance: parseInt(radius) || 1000,
                    spherical: true
                }
            },
            {
                $lookup: {
                    from: 'statuses',
                    let: { businessId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$business', '$$businessId'] },
                                        { $eq: ['$isActive', true] },
                                        { $gt: ['$expiresAt', new Date()] }
                                    ]
                                }
                            }
                        },
                        { $sort: { createdAt: -1 } },
                        { $limit: limit }
                    ],
                    as: 'statuses'
                }
            },
            { $unwind: '$statuses' },
            {
                $project: {
                    _id: '$statuses._id',
                    creator: '$statuses.creator',
                    business: '$_id',
                    content: '$statuses.content',
                    mediaUrl: '$statuses.mediaUrl',
                    mediaType: '$statuses.mediaType',
                    createdAt: '$statuses.createdAt',
                    distance: 1
                }
            },
            { $skip: skip },
            { $limit: limit }
        ]);

        // Récupérer les statuts utilisateurs promus à proximité
        const userStatuses = await User.aggregate([
            {
                $geoNear: {
                    near: {
                        type: 'Point',
                        coordinates: [parseFloat(longitude), parseFloat(latitude)]
                    },
                    distanceField: 'distance',
                    maxDistance: parseInt(radius) || 1000,
                    spherical: true
                }
            },
            {
                $lookup: {
                    from: 'statuses',
                    let: { userId: '$_id' },
                    pipeline: [
                        {
                            $match: {
                                $expr: {
                                    $and: [
                                        { $eq: ['$creator', '$$userId'] },
                                        { $eq: ['$isActive', true] },
                                        { $eq: ['$isPromoted', true] },
                                        { $gt: ['$expiresAt', new Date()] },
                                        { $not: { $ifNull: ['$business', false] } }
                                    ]
                                }
                            }
                        },
                        { $sort: { createdAt: -1 } },
                        { $limit: limit }
                    ],
                    as: 'statuses'
                }
            },
            { $unwind: '$statuses' },
            {
                $project: {
                    _id: '$statuses._id',
                    creator: '$statuses.creator',
                    content: '$statuses.content',
                    mediaUrl: '$statuses.mediaUrl',
                    mediaType: '$statuses.mediaType',
                    createdAt: '$statuses.createdAt',
                    distance: 1
                }
            },
            { $skip: skip },
            { $limit: limit }
        ]);

        // Combiner et trier les résultats par date
        const combinedStatuses = [...businessStatuses, ...userStatuses]
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, limit);

        // Populer les références
        const populatedStatuses = await Status.populate(combinedStatuses, [
            { path: 'creator', select: 'userPseudo profile.photo' },
            { path: 'business', select: 'name description category photos' }
        ]);

        res.status(200).json({
            statuses: populatedStatuses,
            currentPage: page
        });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Voir un statut (ajout d'une vue)
export const viewStatus = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { statusId } = req.params;
        const { userId, duration } = req.body;

        const status = await Status.findById(statusId).session(session);
        if (!status) {
            return res.status(404).json({ message: 'Statut non trouvé' });
        }

        // Vérifier si l'utilisateur a déjà vu ce statut
        const existingViewIndex = status.views.findIndex(view =>
            view.user.toString() === userId
        );

        const now = new Date();

        if (existingViewIndex !== -1) {
            // Ajouter une nouvelle session de visualisation
            status.views[existingViewIndex].viewedAt.push({
                duration: duration || 0,
                type: now
            });
        } else {
            // Ajouter une nouvelle vue
            status.views.push({
                user: userId,
                viewedAt: [{
                    duration: duration || 0,
                    type: now
                }]
            });
        }

        // Mettre à jour le total des vues
        status.totalViews = status.views.length;

        // Calculer la durée moyenne de visualisation
        let totalDuration = 0;
        let totalSessions = 0;

        status.views.forEach(view => {
            view.viewedAt.forEach(session => {
                totalDuration += session.duration || 0;
                totalSessions++;
            });
        });

        status.averageViewDuration = totalSessions > 0 ? totalDuration / totalSessions : 0;

        await status.save({ session });

        // Mettre à jour les statistiques de l'utilisateur
        const user = await User.findById(status.creator).session(session);
        if (user) {
            const viewerEntry = {
                userId: userId,
                viewDuration: duration || 0,
                viewedAt: now
            };

            // Rechercher si l'entrée existe déjà
            const existingViewerIndex = user.profile.statusViewers.findIndex(
                viewer => viewer.userId.toString() === userId
            );

            if (existingViewerIndex !== -1) {
                user.profile.statusViewers[existingViewerIndex] = viewerEntry;
            } else {
                user.profile.statusViewers.push(viewerEntry);
            }

            await user.save({ session });
        }

        // Si le statut a été partagé, mettre à jour les statistiques de partage
        if (req.body.sharedBy) {
            const shareIndex = status.shares.findIndex(
                share => share.user.toString() === req.body.sharedBy
            );

            if (shareIndex !== -1) {
                status.shares[shareIndex].viewsGenerated += 1;
                // Calculer les gains potentiels
                status.shares[shareIndex].earnings =
                    status.shares[shareIndex].viewsGenerated *
                    (status.shares[shareIndex].pricePerView || 0.001); await status.save({ session });
            }
        }

        await session.commitTransaction();
        session.endSession();

        res.status(200).json({ message: 'Vue enregistrée avec succès' });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(500).json({ message: error.message });
    }
};

// Partager un statut
export const shareStatus = async (req, res) => {
    try {
        const { statusId } = req.params;
        const { userId, pricePerView } = req.body;

        const status = await Status.findById(statusId);
        if (!status) {
            return res.status(404).json({ message: 'Statut non trouvé' });
        }

        // Vérifier si l'utilisateur a déjà partagé ce statut
        const existingShareIndex = status.shares.findIndex(share =>
            share.user.toString() === userId
        );

        if (existingShareIndex !== -1) {
            return res.status(400).json({ message: 'Vous avez déjà partagé ce statut' });
        }

        // Ajouter le partage
        status.shares.push({
            user: userId,
            sharedAt: new Date(),
            viewsGenerated: 0,
            earnings: 0,
            isPaid: false,
            pricePerView: pricePerView || 0.001
        });

        // Mettre à jour le total des partages
        status.totalShares = status.shares.length;

        await status.save();

        // Ajouter le statut partagé dans le profil de l'utilisateur
        await User.findByIdAndUpdate(userId, {
            $push: { statusShared: { statusId: status._id } }
        });

        res.status(200).json({ message: 'Statut partagé avec succès' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Supprimer un statut
export const deleteStatus = async (req, res) => {
    try {
        const { statusId } = req.params;
        const { userId } = req.body;

        const status = await Status.findById(statusId);
        if (!status) {
            return res.status(404).json({ message: 'Statut non trouvé' });
        }

        // Vérifier si l'utilisateur est le créateur
        if (status.creator.toString() !== userId) {
            return res.status(403).json({ message: 'Vous n\'êtes pas autorisé à supprimer ce statut' });
        }

        // Supprimer le média associé si existant
        if (status.mediaUrl) {
            await deleteMedia(status.mediaUrl);
        }

        await Status.findByIdAndDelete(statusId);

        res.status(200).json({ message: 'Statut supprimé avec succès' });
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Mettre à jour un statut
export const updateStatus = async (req, res) => {
    try {
        const { statusId } = req.params;
        const { userId, content, isPromoted, promotionRadius } = req.body;

        const status = await Status.findById(statusId);
        if (!status) {
            return res.status(404).json({ message: 'Statut non trouvé' });
        }

        // Vérifier si l'utilisateur est le créateur
        if (status.creator.toString() !== userId) {
            return res.status(403).json({ message: 'Vous n\'êtes pas autorisé à modifier ce statut' });
        }

        // Mettre à jour les champs
        if (content) status.content = content;
        if (isPromoted !== undefined) status.isPromoted = isPromoted;
        if (promotionRadius) status.promotionRadius = promotionRadius;

        await status.save();

        res.status(200).json(status);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Obtenir les statistiques d'un statut
export const getStatusStats = async (req, res) => {
    try {
        const { statusId } = req.params;

        const status = await Status.findById(statusId)
            .populate('views.user', 'userPseudo profile.photo')
            .populate('shares.user', 'userPseudo profile.photo');

        if (!status) {
            return res.status(404).json({ message: 'Statut non trouvé' });
        }

        // Statistiques détaillées
        const stats = {
            totalViews: status.totalViews,
            uniqueViewers: status.views.length,
            totalShares: status.totalShares,
            averageViewDuration: status.averageViewDuration,
            viewsByTime: {}, // Distribution des vues par heure
            topViewers: [], // Les utilisateurs qui ont passé le plus de temps sur le statut
            sharesPerformance: [] // Performance des partages
        };

        // Distribution des vues par heure
        status.views.forEach(view => {
            view.viewedAt.forEach(session => {
                const hour = new Date(session.type).getHours();
                stats.viewsByTime[hour] = (stats.viewsByTime[hour] || 0) + 1;
            });
        });

        // Top viewers par durée
        const viewerTimes = {};
        status.views.forEach(view => {
            const userId = view.user._id.toString();
            viewerTimes[userId] = viewerTimes[userId] || { user: view.user, totalTime: 0 };

            view.viewedAt.forEach(session => {
                viewerTimes[userId].totalTime += session.duration || 0;
            });
        });

        stats.topViewers = Object.values(viewerTimes)
            .sort((a, b) => b.totalTime - a.totalTime)
            .slice(0, 10);

        // Performance des partages
        stats.sharesPerformance = status.shares.map(share => ({
            user: share.user,
            viewsGenerated: share.viewsGenerated,
            earnings: share.earnings,
            isPaid: share.isPaid
        })).sort((a, b) => b.viewsGenerated - a.viewsGenerated);

        res.status(200).json(stats);
    } catch (error) {
        res.status(500).json({ message: error.message });
    }
};

// Payer les gains des partages
export const payShareEarnings = async (req, res) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
        const { statusId, userId } = req.params;

        const status = await Status.findById(statusId).session(session);
        if (!status) {
            return res.status(404).json({ message: 'Statut non trouvé' });
        }

        // Vérifier si l'utilisateur est le créateur du statut
        if (status.creator.toString() !== userId) {
            return res.status(403).json({ message: 'Vous n\'êtes pas autorisé à effectuer cette action' });
        }

        // Trouver tous les partages non payés
        const unpaidShares = status.shares.filter(share => !share.isPaid && share.earnings > 0);

        if (unpaidShares.length === 0) {
            return res.status(400).json({ message: 'Aucun partage à payer' });
        }

        // Calculer le montant total à payer
        const totalToPay = unpaidShares.reduce((sum, share) => sum + share.earnings, 0);

        // Vérifier le solde du créateur
        const creator = await User.findById(userId).session(session);
        if (!creator || creator.wallet.balance < totalToPay) {
            return res.status(400).json({ message: 'Solde insuffisant pour payer les partages' });
        }

        // Payer chaque partage
        for (const share of unpaidShares) {
            // Réduire le solde du créateur
            creator.wallet.balance -= share.earnings;

            // Augmenter le solde du partageur
            const sharer = await User.findById(share.user).session(session);
            if (sharer) {
                sharer.wallet.balance += share.earnings;
                await sharer.save({ session });

                // Marquer le partage comme payé
                const shareIndex = status.shares.findIndex(s => s.user.toString() === share.user.toString());
                if (shareIndex !== -1) {
                    status.shares[shareIndex].isPaid = true;
                }
            }
        }

        await creator.save({ session });
        await status.save({ session });

        await session.commitTransaction();
        session.endSession();

        res.status(200).json({ message: 'Paiements effectués avec succès', amountPaid: totalToPay });
    } catch (error) {
        await session.abortTransaction();
        session.endSession();
        res.status(500).json({ message: error.message });
    }
};