import Status from "../models/status.model.js";
import User from "../models/user.model.js";
import Business from "../models/business.model.js";
import mongoose from "mongoose";
import { createNotification } from "../services/notificationService.js";
import { findNearbyUsers } from "../services/geoService.js";
import { deleteMedia } from "../config/backblaze.js";

// Configuration des événements socket pour les statuts
export const configureStatusSocket = (io, socket) => {
  // Créer un nouveau statut
  socket.on("status:create", async (data, callback) => {
    try {
      const {
        creator,
        business,
        content,
        mediaType,
        isPromoted,
        promotionRadius,
        mediaUrl,
      } = data;
      // Vérifier que le créateur existe
      const user = await User.findById(creator);
      if (!user) {
        return callback({ error: true, message: "Utilisateur non trouvé" });
      }

      // Si c'est lié à un business, vérifier qu'il existe et appartient au créateur
      if (business) {
        const businessDoc = await Business.findById(business);
        if (!businessDoc) {
          return callback({ error: true, message: "Entreprise non trouvée" });
        }
        if (businessDoc.owner.toString() !== creator) {
          return callback({
            error: true,
            message:
              "Vous n'êtes pas autorisé à créer un statut pour cette entreprise",
          });
        }
      }

      const status = new Status({
        creator,
        business,
        content,
        mediaUrl,
        mediaType: mediaUrl ? mediaType : "text",
        isPromoted,
        promotionRadius: promotionRadius || 1000,
      });

      await status.save();

     /*  // Si le statut est promu, envoyer des notifications aux utilisateurs à proximité
      if (isPromoted) {
        const location = business
          ? (await Business.findById(business)).location.coordinates
          : user.location.coordinates;

        const nearbyUsers = await findNearbyUsers(
          location,
          promotionRadius || 1000,
          creator
        );

        for (const nearbyUser of nearbyUsers) {
          // Ne pas notifier le créateur
          if (nearbyUser._id.toString() === creator) continue;

          // Créer une notification pour chaque utilisateur à proximité
          await createNotification({
            recipient: nearbyUser._id,
            sender: creator,
            type: business ? "business_nearby" : "status_nearby",
            title: business
              ? "Nouveau statut d'entreprise à proximité"
              : "Nouveau statut à proximité",
            message: business
              ? `${
                  (
                    await Business.findById(business)
                  ).name
                } a publié un nouveau statut`
              : `${user.userPseudo} a publié un nouveau statut`,
            relatedEntity: {
              entityType: "Status",
              entityId: status._id,
            },
          });

          // Notifier les utilisateurs connectés via socket.io
          const userSocketId = io.userSockets?.[nearbyUser._id.toString()];
          if (userSocketId) {
            io.to(userSocketId).emit("notification:new", {
              type: business ? "business_nearby" : "status_nearby",
              status: status._id,
            });
          }
        }
      } */

      callback({ error: false, status });
    } catch (error) {
      callback({ error: true, message: error.message });
    }
  });

  // Récupérer un statut par ID
  socket.on("status:getById", async (data, callback) => {
    try {
      const { statusId } = data;
      const status = await Status.findById(statusId)
        .populate("creator", "userPseudo profile.photo")
        .populate("business");

      if (!status) {
        return callback({ error: true, message: "Statut non trouvé" });
      }

      callback({ error: false, status });
    } catch (error) {
      callback({ error: true, message: error.message });
    }
  });

  // Récupérer les statuts d'un utilisateur
  socket.on("status:getUserStatuses", async (data, callback) => {
    try {
      const { userId, page = 1, limit = 10 } = data;
      const skip = (page - 1) * limit;

      const statuses = await Status.find({
        creator: userId,
        isActive: true,
        expiresAt: { $gt: new Date() },
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("creator", "userPseudo profile.photo")
        .populate("business");

      const total = await Status.countDocuments({
        creator: userId,
        isActive: true,
        expiresAt: { $gt: new Date() },
      });

      callback({
        error: false,
        statuses,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        total,
      });
    } catch (error) {
      callback({ error: true, message: error.message });
    }
  });

  // Récupérer les statuts d'une entreprise
  socket.on("status:getUsersStatuses", async (data, callback) => {
    try {
      const { businessId, page = 1, limit = 10 } = data;
      const skip = (page - 1) * limit;

      const statuses = await Status.find({
        business: businessId,
        isActive: true,
        expiresAt: { $gt: new Date() },
      })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate("creator", "userPseudo profile.photo")
        .populate("business");

      const total = await Status.countDocuments({
        business: businessId,
        isActive: true,
        expiresAt: { $gt: new Date() },
      });

      callback({
        error: false,
        statuses,
        totalPages: Math.ceil(total / limit),
        currentPage: page,
        total,
      });
    } catch (error) {
      callback({ error: true, message: error.message });
    }
  });

  // Récupérer les statuts à proximité
  socket.on("status:getNearbyStatuses", async (data, callback) => {
    try {
      const { longitude, latitude, radius = 1000, page = 1, limit = 10 } = data;
      const skip = (page - 1) * limit;

      // Récupérer les statuts promus à proximité
      const businessStatuses = await Business.aggregate([
        {
          $geoNear: {
            near: {
              type: "Point",
              coordinates: [parseFloat(longitude), parseFloat(latitude)],
            },
            distanceField: "distance",
            maxDistance: parseInt(radius),
            spherical: true,
          },
        },
        {
          $lookup: {
            from: "statuses",
            let: { businessId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$business", "$$businessId"] },
                      { $eq: ["$isActive", true] },
                      { $gt: ["$expiresAt", new Date()] },
                    ],
                  },
                },
              },
              { $sort: { createdAt: -1 } },
              { $limit: limit },
            ],
            as: "statuses",
          },
        },
        { $unwind: "$statuses" },
        {
          $project: {
            _id: "$statuses._id",
            creator: "$statuses.creator",
            business: "$_id",
            content: "$statuses.content",
            mediaUrl: "$statuses.mediaUrl",
            mediaType: "$statuses.mediaType",
            createdAt: "$statuses.createdAt",
            distance: 1,
          },
        },
        { $skip: skip },
        { $limit: limit },
      ]);

      // Récupérer les statuts utilisateurs promus à proximité
      const userStatuses = await User.aggregate([
        {
          $geoNear: {
            near: {
              type: "Point",
              coordinates: [parseFloat(longitude), parseFloat(latitude)],
            },
            distanceField: "distance",
            maxDistance: parseInt(radius),
            spherical: true,
          },
        },
        {
          $lookup: {
            from: "statuses",
            let: { userId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: {
                    $and: [
                      { $eq: ["$creator", "$$userId"] },
                      { $eq: ["$isActive", true] },
                      { $eq: ["$isPromoted", true] },
                      { $gt: ["$expiresAt", new Date()] },
                      { $not: { $ifNull: ["$business", false] } },
                    ],
                  },
                },
              },
              { $sort: { createdAt: -1 } },
              { $limit: limit },
            ],
            as: "statuses",
          },
        },
        { $unwind: "$statuses" },
        {
          $project: {
            _id: "$statuses._id",
            creator: "$statuses.creator",
            content: "$statuses.content",
            mediaUrl: "$statuses.mediaUrl",
            mediaType: "$statuses.mediaType",
            createdAt: "$statuses.createdAt",
            distance: 1,
          },
        },
        { $skip: skip },
        { $limit: limit },
      ]);

      // Combiner et trier les résultats par date
      const combinedStatuses = [...businessStatuses, ...userStatuses]
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, limit);

      // Populer les références
      const populatedStatuses = await Status.populate(combinedStatuses, [
        { path: "creator", select: "userPseudo profile.photo" },
        { path: "business", select: "name description category photos" },
      ]);

      callback({
        error: false,
        statuses: populatedStatuses,
        currentPage: page,
      });
    } catch (error) {
      callback({ error: true, message: error.message });
    }
  });

  // Voir un statut (ajout d'une vue)
  socket.on("status:view", async (data, callback) => {
    const session = await mongoose.startSession();
    //session.startTransaction();

    try {
      const { statusId, userId, duration, sharedBy } = data;

      const status = await Status.findById(statusId).session(session);
      if (!status) {
        //    await session.abortTransaction();
        session.endSession();
        return callback({ error: true, message: "Statut non trouvé" });
      }

      // Vérifier si l'utilisateur a déjà vu ce statut
      const existingViewIndex = status.views.findIndex(
        (view) => view.user.toString() === userId
      );

      const now = new Date();

      if (existingViewIndex !== -1) {
        // Ajouter une nouvelle session de visualisation
        status.views[existingViewIndex].viewedAt.push({
          duration: duration || 0,
          type: now,
        });
      } else {
        // Ajouter une nouvelle vue
        status.views.push({
          user: userId,
          viewedAt: [
            {
              duration: duration || 0,
              type: now,
            },
          ],
        });
      }

      // Mettre à jour le total des vues
      status.totalViews = status.views.length;

      // Calculer la durée moyenne de visualisation
      let totalDuration = 0;
      let totalSessions = 0;

      status.views.forEach((view) => {
        view.viewedAt.forEach((session) => {
          totalDuration += session.duration || 0;
          totalSessions++;
        });
      });

      status.averageViewDuration =
        totalSessions > 0 ? totalDuration / totalSessions : 0;

      await status.save({ session });

      // Mettre à jour les statistiques de l'utilisateur
      const user = await User.findById(status.creator).session(session);
      if (user) {
        const viewerEntry = {
          userId: userId,
          viewDuration: duration || 0,
          viewedAt: now,
        };

        // Rechercher si l'entrée existe déjà
        const existingViewerIndex = user.profile.statusViewers.findIndex(
          (viewer) => viewer.userId.toString() === userId
        );

        if (existingViewerIndex !== -1) {
          user.profile.statusViewers[existingViewerIndex] = viewerEntry;
        } else {
          user.profile.statusViewers.push(viewerEntry);
        }

        await user.save({ session });
      }

      // Si le statut a été partagé, mettre à jour les statistiques de partage
      if (sharedBy) {
        const shareIndex = status.shares.findIndex(
          (share) => share.user.toString() === sharedBy
        );

        if (shareIndex !== -1) {
          status.shares[shareIndex].viewsGenerated += 1;
          // Calculer les gains potentiels
          status.shares[shareIndex].earnings =
            status.shares[shareIndex].viewsGenerated *
            (status.shares[shareIndex].pricePerView || 0.0);

          await status.save({ session });
        }
      }

      await session.commitTransaction();
      session.endSession();
      if (global.connectedUsers.has(status.creator.toString())) {
        const receiverSocketsId = global.connectedUsers.get(
          status.creator.toString()
        );
        const receiverSocket = io.sockets.sockets.get(receiverSocketsId);
        if (receiverSocket) {
          receiverSocket.to(creatorSocketId).emit("status:viewed", {
            statusId,
            viewerId: userId,
          });
        }
      }
      callback({ error: false, message: "Vue enregistrée avec succès" });
    } catch (error) {
      // await session.abortTransaction();
      session.endSession();
      callback({ error: true, message: error.message });
    }
  });

  // Partager un statut
  socket.on("status:share", async (data, callback) => {
    try {
      const {
        statusId,
        userId,
        pricePerView,
        minimumViewThreshold,
        rewardPerShare,
      } = data;

      const status = await Status.findById(statusId);
      if (!status) {
        return callback({ error: true, message: "Statut non trouvé" });
      }

      // Vérifier si l'utilisateur a déjà partagé ce statut
      const existingShareIndex = status.shares.findIndex(
        (share) => share.user.toString() === userId
      );

      if (existingShareIndex !== -1) {
        return callback({
          error: true,
          message: "Vous avez déjà partagé ce statut",
        });
      }

      // Ajouter le partage
      status.shares.push({
        user: userId,
        sharedAt: new Date(),
        viewsGenerated: 0,
        earnings: 0,
        isPaid: false,
        revenueSettings: {
          minimumViewThreshold: minimumViewThreshold || 100,
          rewardPerShare: rewardPerShare || 1,
        },
        pricePerView: pricePerView || 0.001,
      });

      // Mettre à jour le total des partages
      status.totalShares = status.shares.length;

      await status.save();

      // Ajouter le statut partagé dans le profil de l'utilisateur
      await User.findByIdAndUpdate(userId, {
        $push: { statusShared: { statusId: status._id } },
      });
      if (global.connectedUsers.has(status.creator.toString())) {
        const receiverSocketsId = global.connectedUsers.get(
          status.creator.toString()
        );
        const receiverSocket = io.sockets.sockets.get(receiverSocketsId);
        if (receiverSocket) {
          receiverSocket.to(creatorSocketId).emit("status:shared", {
            statusId,
            viewerId: userId,
          });
        }
      }

      // Notifier le créateur du statut via socket.io

      callback({ error: false, message: "Statut partagé avec succès" });
    } catch (error) {
      callback({ error: true, message: error.message });
    }
  });

  // Supprimer un statut
  socket.on("status:delete", async (data, callback) => {
    try {
      const { statusId, userId } = data;

      const status = await Status.findById(statusId);
      if (!status) {
        return callback({ error: true, message: "Statut non trouvé" });
      }

      // Vérifier si l'utilisateur est le créateur
      if (status.creator.toString() !== userId) {
        return callback({
          error: true,
          message: "Vous n'êtes pas autorisé à supprimer ce statut",
        });
      }

      // Supprimer le média associé si existant
      if (status.mediaUrl) {
        await deleteMedia(status.mediaUrl);
      }

      await Status.findByIdAndDelete(statusId);

      callback({ error: false, message: "Statut supprimé avec succès" });
    } catch (error) {
      callback({ error: true, message: error.message });
    }
  });

  // Mettre à jour un statut
  socket.on("status:update", async (data, callback) => {
    try {
      const { statusId, userId, content, isPromoted, promotionRadius } = data;

      const status = await Status.findById(statusId);
      if (!status) {
        return callback({ error: true, message: "Statut non trouvé" });
      }

      // Vérifier si l'utilisateur est le créateur
      if (status.creator.toString() !== userId) {
        return callback({
          error: true,
          message: "Vous n'êtes pas autorisé à modifier ce statut",
        });
      }

      // Mettre à jour les champs
      if (content) status.content = content;
      if (isPromoted !== undefined) status.isPromoted = isPromoted;
      if (promotionRadius) status.promotionRadius = promotionRadius;

      await status.save();

      callback({ error: false, status });
    } catch (error) {
      callback({ error: true, message: error.message });
    }
  });

  // Obtenir les statistiques d'un statut
  socket.on("status:getStats", async (data, callback) => {
    try {
      const { statusId } = data;

      const status = await Status.findById(statusId)
        .populate("views.user", "userPseudo profile.photo")
        .populate("shares.user", "userPseudo profile.photo");

      if (!status) {
        return callback({ error: true, message: "Statut non trouvé" });
      }

      // Statistiques détaillées
      const stats = {
        totalViews: status.totalViews,
        uniqueViewers: status.views.length,
        totalShares: status.totalShares,
        averageViewDuration: status.averageViewDuration,
        viewsByTime: {}, // Distribution des vues par heure
        topViewers: [], // Les utilisateurs qui ont passé le plus de temps sur le statut
        sharesPerformance: [], // Performance des partages
      };

      // Distribution des vues par heure
      status.views.forEach((view) => {
        view.viewedAt.forEach((session) => {
          const hour = new Date(session.type).getHours();
          stats.viewsByTime[hour] = (stats.viewsByTime[hour] || 0) + 1;
        });
      });

      // Top viewers par durée
      const viewerTimes = {};
      status.views.forEach((view) => {
        const userId = view.user._id.toString();
        viewerTimes[userId] = viewerTimes[userId] || {
          user: view.user,
          totalTime: 0,
        };

        view.viewedAt.forEach((session) => {
          viewerTimes[userId].totalTime += session.duration || 0;
        });
      });

      stats.topViewers = Object.values(viewerTimes)
        .sort((a, b) => b.totalTime - a.totalTime)
        .slice(0, 10);

      // Performance des partages
      stats.sharesPerformance = status.shares
        .map((share) => ({
          user: share.user,
          viewsGenerated: share.viewsGenerated,
          earnings: share.earnings,
          isPaid: share.isPaid,
        }))
        .sort((a, b) => b.viewsGenerated - a.viewsGenerated);

      callback({ error: false, stats });
    } catch (error) {
      callback({ error: true, message: error.message });
    }
  });

  // Payer les gains des partages
  socket.on("status:payShareEarnings", async (data, callback) => {
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      const { statusId, userId } = data;

      const status = await Status.findById(statusId).session(session);
      if (!status) {
        await session.abortTransaction();
        session.endSession();
        return callback({ error: true, message: "Statut non trouvé" });
      }

      // Vérifier si l'utilisateur est le créateur du statut
      if (status.creator.toString() !== userId) {
        await session.abortTransaction();
        session.endSession();
        return callback({
          error: true,
          message: "Vous n'êtes pas autorisé à effectuer cette action",
        });
      }

      // Trouver tous les partages non payés
      const unpaidShares = status.shares.filter(
        (share) => !share.isPaid && share.earnings > 0
      );

      if (unpaidShares.length === 0) {
        await session.abortTransaction();
        session.endSession();
        return callback({ error: true, message: "Aucun partage à payer" });
      }

      // Calculer le montant total à payer
      const totalToPay = unpaidShares.reduce(
        (sum, share) => sum + share.earnings,
        0
      );

      // Vérifier le solde du créateur
      const creator = await User.findById(userId).session(session);
      if (!creator || creator.wallet.balance < totalToPay) {
        await session.abortTransaction();
        session.endSession();
        return callback({
          error: true,
          message: "Solde insuffisant pour payer les partages",
        });
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
          const shareIndex = status.shares.findIndex(
            (s) => s.user.toString() === share.user.toString()
          );
          if (shareIndex !== -1) {
            status.shares[shareIndex].isPaid = true;
          }

          // Notifier l'utilisateur qui a partagé via socket.io
          const sharerSocketId = io.userSockets?.[share.user.toString()];
          if (sharerSocketId) {
            io.to(sharerSocketId).emit("payment:received", {
              from: userId,
              for: "status_share",
              statusId,
              amount: share.earnings,
            });
          }
        }
      }

      await creator.save({ session });
      await status.save({ session });

      await session.commitTransaction();
      session.endSession();

      callback({
        error: false,
        message: "Paiements effectués avec succès",
        amountPaid: totalToPay,
      });
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      callback({ error: true, message: error.message });
    }
  });
};
