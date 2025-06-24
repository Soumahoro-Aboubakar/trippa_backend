import Fuse from "fuse.js";
import Room from "../models/room.model.js";

/**
 * Configuration de la recherche avec Fuse.js
 */

/*
exeple d'utilisation des fonctions de recherche : // Installation des dépendances
npm install fuse.js

// Recherche basique
const results = await advancedRoomSearch("développeur", {}, userId);

// Recherche avec filtres avancés
const filteredResults = await searchWithFilters("javascript", {
  minRating: 4,
  maxMembers: 50,
  isPaid: false,
  userLocation: { lat: 48.8566, lng: 2.3522 }
}, userId);

// Recherche rapide (MongoDB uniquement)
const quickResults = await quickRoomSearch("react", { maxResults: 20 });

*/

const FUSE_OPTIONS = {
  includeScore: true,
  includeMatches: true,
  threshold: 0.4, // 0 = correspondance exacte, 1 = correspondance très flexible
  location: 0,
  distance: 100,
  maxPatternLength: 32,
  minMatchCharLength: 2,
  keys: [
    {
      name: "name",
      weight: 0.5, // Poids le plus élevé pour le nom
    },
    {
      name: "description",
      weight: 0.5,
    },
  ],
};

/**
 * Options de recherche configurables
 */
const SEARCH_CONFIG = {
  maxResults: 50,
  enableFuzzySearch: true,
  enableGeolocation: false,
  sortByRelevance: true,
  includePrivateRooms: false,
  includeInactiveRooms: false,
};

/**
 * Fonction principale de recherche avancée
 * @param {string} searchQuery - Texte de recherche saisi par l'utilisateur
 * @param {Object} options - Options de recherche personnalisées
 * @param {string} userId - ID de l'utilisateur effectuant la recherche
 * @param {Object} userLocation - Coordonnées de l'utilisateur {lat, lng} (optionnel)
 * @returns {Promise<Array>} - Liste des rooms triées par pertinence
 */

export async function advandedRoomSearch(data, callback) {
  const {
    searchQuery = "",
    options = {},
    userId = null,
    userLocation = null,
  } = data;

  try {
    const results = advancedRoomSearch(
      searchQuery,
      options,
      userId,
      userLocation
    );
    return callback({ romms: results });
  } catch (error) {
    callback({
      error: "Erreur interne lors de la recherche",
      details: error.message,
    });
  }

  //callback({ error: "Erreur interne lors de la recherche", details: error.message });
}

export async function advancedRoomSearch(
  searchQuery = "",
  options = {},
  userId = null,
  userLocation = null
) {
  try {
    // Validation des paramètres
    if (
      !searchQuery ||
      typeof searchQuery !== "string" ||
      searchQuery.trim().length < 2
    ) {
      throw new Error(
        "La requête de recherche doit contenir au moins 2 caractères"
      );
    }

    // Fusion des options par défaut avec les options personnalisées
    const config = { ...SEARCH_CONFIG, ...options };

    // Nettoyage et normalisation de la requête
    const cleanQuery = normalizeSearchQuery(searchQuery);

    // Étape 1: Recherche MongoDB optimisée (pré-filtrage)
    const mongoResults = await performMongoSearch(cleanQuery, config, userId);

    // Si peu de résultats MongoDB, retourner directement
    if (mongoResults.length <= 10) {
      const rooms = await enrichResultsWithMetadata(
        mongoResults,
        cleanQuery,
        userLocation
      );
      return rooms;
    }

    // Étape 2: Recherche Fuse.js pour affiner la pertinence
    const fuseResults = await performFuseSearch(
      mongoResults,
      cleanQuery,
      config
    );

    // Étape 3: Post-traitement et enrichissement
    const finalResults = await enrichResultsWithMetadata(
      fuseResults,
      cleanQuery,
      userLocation
    );

    const results = finalResults.slice(0, config.maxResults);
    return results;
  } catch (error) {
    console.error("Erreur lors de la recherche avancée:", error);
    throw new error("Erreur interne lors de la recherche");
  }
}

/**
 * Normalise et nettoie la requête de recherche
 * @param {string} query - Requête brute
 * @returns {string} - Requête normalisée
 */
function normalizeSearchQuery(query) {
  return query
    .trim()
    .toLowerCase()
    .normalize("NFD") // Normalisation Unicode
    .replace(/[\u0300-\u036f]/g, "") // Suppression des accents
    .replace(/[^\w\s-]/g, " ") // Suppression caractères spéciaux
    .replace(/\s+/g, " "); // Normalisation des espaces
}

/**
 * Recherche MongoDB optimisée avec agrégation
 * @param {string} query - Requête normalisée
 * @param {Object} config - Configuration de recherche
 * @param {string} userId - ID utilisateur
 * @returns {Promise<Array>} - Résultats MongoDB
 */
async function performMongoSearch(query, config, userId) {
  const pipeline = [];

  // Étape 1: Filtrage de base
  const matchStage = {
    $match: {
      isActive: config.includeInactiveRooms ? { $in: [true, false] } : true,
      isSearchable: true,
      ...(userId && { "bannedUsers.userId": { $ne: userId } }),
    },
  };

  // Ajout des filtres de visibilité
  if (!config.includePrivateRooms) {
    matchStage.$match.visibility = { $in: ["public", "friends"] };
  }

  pipeline.push(matchStage);

  // Étape 2: Recherche textuelle
  if (query) {
    pipeline.push({
      $match: {
        $or: [
          { $text: { $search: query } },
          { name: { $regex: query, $options: "i" } },
          { description: { $regex: query, $options: "i" } },
          { accessCode: { $regex: query, $options: "i" } },
        ],
      },
    });
  }

  // Étape 3: Calcul du score de pertinence
  pipeline.push({
    $addFields: {
      relevanceScore: {
        $add: [
          // Score basé sur la recherche textuelle MongoDB
          { $ifNull: [{ $meta: "textScore" }, 0] },

          // Bonus pour correspondance exacte dans le nom
          {
            $cond: [
              { $regexMatch: { input: "$name", regex: query, options: "i" } },
              10,
              0,
            ],
          },

          // Bonus pour correspondance au début du nom
          {
            $cond: [
              {
                $regexMatch: {
                  input: "$name",
                  regex: `^${query}`,
                  options: "i",
                },
              },
              15,
              0,
            ],
          },

          // Score basé sur les ratings
          { $multiply: ["$averageRating", 0.5] },

          // Score basé sur le nombre de membres
          { $multiply: [{ $size: { $ifNull: ["$members", []] } }, 0.1] },

          // Bonus pour les groupes vérifiés
          { $cond: ["$isVerified", 5, 0] },
        ],
      },
    },
  });

  // Étape 4: Tri par pertinence
  pipeline.push({ $sort: { relevanceScore: -1, createdAt: -1 } });

  // Étape 5: Limitation des résultats
  pipeline.push({ $limit: config.maxResults * 2 }); // Plus de résultats pour Fuse.js

  // Étape 6: Population des références
  pipeline.push({
    $lookup: {
      from: "users",
      localField: "creator",
      foreignField: "_id",
      as: "creatorInfo",
      pipeline: [{ $project: { name: 1, avatar: 1 } }],
    },
  });

  return await Room.aggregate(pipeline);
}

/**
 * Recherche avec Fuse.js pour affiner la pertinence
 * @param {Array} mongoResults - Résultats de MongoDB
 * @param {string} query - Requête de recherche
 * @param {Object} config - Configuration
 * @returns {Array} - Résultats Fuse.js
 */
async function performFuseSearch(mongoResults, query, config) {
  if (!config.enableFuzzySearch || mongoResults.length === 0) {
    return mongoResults;
  }

  // Préparation des données pour Fuse.js
  const searchableData = mongoResults.map((room) => ({
    ...room,
    // Aplatissement des données pour la recherche
    searchableText:
      `${room.name} ${room.description}`.toLowerCase(),
  }));

  const fuse = new Fuse(searchableData, FUSE_OPTIONS);
  const fuseResults = fuse.search(query);

  // Combinaison des scores MongoDB et Fuse.js
  return fuseResults
    .map((result) => ({
      ...result.item,
      combinedScore:
        (result.item.relevanceScore || 0) + (1 - result.score) * 20,
      fuseScore: result.score,
      matches: result.matches,
    }))
    .sort((a, b) => b.combinedScore - a.combinedScore);
}

/**
 * Enrichissement des résultats avec métadonnées supplémentaires
 * @param {Array} results - Résultats de recherche
 * @param {string} query - Requête originale
 * @param {Object} userLocation - Position de l'utilisateur
 * @returns {Promise<Array>} - Résultats enrichis
 */
async function enrichResultsWithMetadata(results, query, userLocation) {
  return results.map((room) => {
    const enrichedRoom = {
      ...room,
      memberCount: room.members ? room.members.length : 0,
      hasLocation: !!(
        room.location &&
        room.location.coordinates &&
        room.location.coordinates[0] !== 0 &&
        room.location.coordinates[1] !== 0
      ),
      searchRelevance: {
        score: room.combinedScore || room.relevanceScore || 0,
        fuseScore: room.fuseScore,
        matches: room.matches || [],
      },
    };

    // Calcul de la distance si localisation disponible
    if (userLocation && enrichedRoom.hasLocation) {
      enrichedRoom.distance = calculateDistance(
        userLocation.lat,
        userLocation.lng,
        room.location.coordinates[1], // latitude
        room.location.coordinates[0] // longitude
      );
    }

    return enrichedRoom;
  });
}

/**
 * Calcul de la distance entre deux points (formule de Haversine)
 * @param {number} lat1 - Latitude point 1
 * @param {number} lon1 - Longitude point 1
 * @param {number} lat2 - Latitude point 2
 * @param {number} lon2 - Longitude point 2
 * @returns {number} - Distance en kilomètres
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Rayon de la Terre en km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Recherche avec filtres avancés
 * @param {string} searchQuery - Requête de recherche
 * @param {Object} filters - Filtres avancés
 * @param {string} userId - ID utilisateur
 * @returns {Promise<Array>} - Résultats filtrés
 */
export async function searchWithFilters(data, callback) {
  const { searchQuery, filters = {}, userId = null } = data;
  const searchOptions = {
    maxResults: filters.limit || 50,
    includePrivateRooms: filters.includePrivate || false,
    includeInactiveRooms: filters.includeInactive || false,
  };

  try {
    const results = await advancedRoomSearch(
      searchQuery,
      searchOptions,
      userId,
      filters.userLocation
    );
    // Application des filtres supplémentaires
    let filteredResults = results;

    if (filters.minRating) {
      filteredResults = filteredResults.filter(
        (room) => room.averageRating >= filters.minRating
      );
    }

    if (filters.maxMembers) {
      filteredResults = filteredResults.filter(
        (room) => room.memberCount <= filters.maxMembers
      );
    }

    if (filters.minMembers) {
      filteredResults = filteredResults.filter(
        (room) => room.memberCount >= filters.minMembers
      );
    }

    if (filters.isPaid !== undefined) {
      filteredResults = filteredResults.filter(
        (room) => room.isPaid === filters.isPaid
      );
    }

    if (filters.isVerified !== undefined) {
      filteredResults = filteredResults.filter(
        (room) => room.isVerified === filters.isVerified
      );
    }

    if (filters.maxDistance && filters.userLocation) {
      filteredResults = filteredResults.filter(
        (room) => !room.distance || room.distance <= filters.maxDistance
      );
    }

    return callback({ rooms: filteredResults });
  } catch (error) {
    console.error(
      "Une erreur interne  apparue  lors de la récupération des rooms",
      error
    );
    callback({
      error: "Erreur interne lors de la recherche",
      details: error.message,
    });
  }
}

/**
 * Fonction utilitaire pour recherche rapide (sans Fuse.js)
 * @param {string} searchQuery - Requête de recherche
 * @param {Object} options - Options simplifiées
 * @returns {Promise<Array>} - Résultats MongoDB uniquement
 */
export async function quickRoomSearch(data, callback) {
  const { searchQuery, options = {} } = data;
  const config = {
    ...SEARCH_CONFIG,
    ...options,
    enableFuzzySearch: false,
  };

  try {
    const cleanQuery = normalizeSearchQuery(searchQuery);
    const results = await performMongoSearch(
      cleanQuery,
      config,
      options.userId
    );

    const searchResults = await enrichResultsWithMetadata(
      results,
      cleanQuery,
      options.userLocation
    );
    return callback({ rooms: searchResults });
  } catch (error) {
    console.error(
      "Une erreur interne  apparue  lors de la récupération des rooms",
      error
    );
    callback({
      error: "Erreur interne lors de la recherche",
      details: error.message,
    });
  }
}

//___________________________________________________________________________________________________________

/**
 * Fonction pour rechercher un groupe par son code d'accès
 * @param {string} accessCode - Code d'accès du groupe (accessCode)
 * @param {string} userId - ID de l'utilisateur effectuant la recherche
 * @param {Object} options - Options de recherche
 * @returns {Promise<Object|null>} - Groupe trouvé ou null
 */
export async function findRoomByAccessCode(
  accessCode,
  userId = null,
  options = {}
) {
  try {
    // Validation du code d'accès
    if (
      !accessCode ||
      typeof accessCode !== "string" ||
      accessCode.trim().length < 3
    ) {
      throw new Error("Le code d'accès doit contenir au moins 3 caractères");
    }

    // Nettoyage du code d'accès
    const cleanAccessCode = accessCode.trim().toUpperCase();

    // Configuration par défaut
    const config = {
      includeInactiveRooms: false,
      checkBannedUsers: true,
      populateCreator: true,
      ...options,
    };

    // Construction de la requête MongoDB
    const query = {
      $or: [
        { accessCode: cleanAccessCode },
      ],
      isActive: config.includeInactiveRooms ? { $in: [true, false] } : true,
    };

    // Vérification si l'utilisateur n'est pas banni (si userId fourni)
    if (userId && config.checkBannedUsers) {
      query["bannedUsers.userId"] = { $ne: userId };
    }

    // Recherche du groupe avec population des données
    let roomQuery = Room.findOne(query);

    // Population des informations du créateur si demandé
    if (config.populateCreator) {
      roomQuery = roomQuery.populate("creator", "name email avatar isVerified");
    }

    const room = await roomQuery.exec();

    if (!room) {
      return null;
    }

    // Enrichissement des données du groupe
    const enrichedRoom = await enrichRoomData(room, userId);

    return enrichedRoom;
  } catch (error) {
    console.error("Erreur lors de la recherche par code d'accès:", error);
    throw new Error("Erreur lors de la recherche du groupe");
  }
}

/**
 * Fonction pour vérifier si un utilisateur peut rejoindre un groupe via son code d'accès
 * @param {string} accessCode - Code d'accès du groupe
 * @param {string} userId - ID de l'utilisateur
 * @returns {Promise<Object>} - Résultat de la vérification avec le groupe et les permissions
 */
export async function getRommByAccessCode(data, callback) {
  const { accessCode, userId } = data;
  try {
    if (!userId) {
      throw new Error("ID utilisateur requis pour la vérification");
    }

    // Recherche du groupe
    const room = await findRoomByAccessCode(accessCode, userId, {
      populateCreator: true,
      checkBannedUsers: true,
    });

    if (!room) {
      return callback({
        error: "Aucun groupe trouvé avec ce code d'accès",
        details: "Le groupe est introuvable",
      });
    }

    // Vérifications des permissions
    const verificationResult = {
      success: true,
      room: room,
      permissions: {
        canJoin: true,
        isAlreadyMember: false,
        requiresPayment: false,
        isPrivateWithCode: false,
        reasonsBlocked: [],
      },
    };

    // Vérifier si l'utilisateur est déjà membre
    if (room.members && room.members.includes(userId)) {
      verificationResult.permissions.isAlreadyMember = true;
      verificationResult.permissions.canJoin = false;
      verificationResult.permissions.reasonsBlocked.push(
        "Vous êtes déjà membre de ce groupe"
      );
    }

    // Vérifier si le groupe est payant
    if (room.isPaid && room.price > 0) {
      verificationResult.permissions.requiresPayment = true;
      verificationResult.permissions.paymentAmount = room.price;
    }

    // Vérifier si c'est un groupe privé avec code d'accès
    if (room.isPrivate && room.accessCode) {
      verificationResult.permissions.isPrivateWithCode = true;
    }

    // Vérifier si le groupe est plein (si limite définie)
    if (
      room.maxMembers &&
      room.members &&
      room.members.length >= room.maxMembers
    ) {
      verificationResult.permissions.canJoin = false;
      verificationResult.permissions.reasonsBlocked.push(
        "Le groupe a atteint sa capacité maximale"
      );
    }

    // Vérifier si le groupe est encore actif
    if (!room.isActive) {
      verificationResult.permissions.canJoin = false;
      verificationResult.permissions.reasonsBlocked.push(
        "Ce groupe n'est plus actif"
      );
    }

    // Si il y a des raisons de blocage, success = false
    if (
      verificationResult.permissions.reasonsBlocked.length > 0 &&
      !verificationResult.permissions.isAlreadyMember
    ) {
      verificationResult.success = false;
      verificationResult.message =
        verificationResult.permissions.reasonsBlocked.join(", ");
    }

    //return verificationResult;
    return callback({ room: verificationResult });
  } catch (error) {
    console.error("Erreur lors de la vérification des permissions:", error);
    callback({
      error: "Une Erreur  apparue lors de la récupération du groups",
      details: error.message,
    });
  }
}

/**
 * Enrichissement des données du groupe avec métadonnées utiles
 * @param {Object} room - Objet room MongoDB
 * @param {string} userId - ID de l'utilisateur (optionnel)
 * @returns {Promise<Object>} - Groupe enrichi
 */
async function enrichRoomData(room, userId = null) {
  const enrichedRoom = room.toObject();

  // Calcul du nombre de membres
  enrichedRoom.memberCount = room.members ? room.members.length : 0;

  // Calcul du nombre d'admins
  enrichedRoom.adminCount = room.admins ? room.admins.length : 0;

  // Vérification si l'utilisateur est membre/admin
  if (userId) {
    enrichedRoom.userPermissions = {
      isMember: room.members ? room.members.includes(userId) : false,
      isAdmin: room.admins ? room.admins.includes(userId) : false,
      isCreator: room.creator && room.creator.toString() === userId,
      isBanned: room.bannedUsers
        ? room.bannedUsers.some((ban) => ban.userId.toString() === userId)
        : false,
    };
  }

  // Informations sur la localisation
  enrichedRoom.hasLocation = !!(
    room.location &&
    room.location.coordinates &&
    room.location.coordinates[0] !== 0 &&
    room.location.coordinates[1] !== 0
  );

  // Informations sur les ratings
  enrichedRoom.ratingStats = {
    averageRating: room.averageRating || 0,
    totalRatings: room.ratings ? room.ratings.length : 0,
  };

  // Informations sur le wallet (si applicable)
  if (room.wallet) {
    enrichedRoom.walletInfo = {
      hasBalance: room.wallet.balance > 0,
      balance: room.wallet.balance || 0,
      transactionCount: room.wallet.transactions
        ? room.wallet.transactions.length
        : 0,
    };
  }

  // Statut de remboursement
  enrichedRoom.refundInfo = {
    isRefundable: room.refundable || false,
    refundPeriodDays: room.refundPeriodDays || 0,
  };

  return enrichedRoom;
}

///______________________________________________________________________________________

// Export des configurations pour personnalisation
export { FUSE_OPTIONS, SEARCH_CONFIG };
