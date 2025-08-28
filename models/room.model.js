import mongoose from "mongoose";
/*

  const uniqueMembers = [...new Set(convertedMembers.map(id => id.toString()))]
      .map(id => new mongoose.Types.ObjectId(id));

    // Conversion du créateur en ObjectId pour les admins
    const creatorObjectId = new mongoose.Types.ObjectId(socket.userData._id);


    */
/**
 * Schema pour les salles/groupes de discussion
 * Support de 6 types de salles : payante, gratuite, localisée, anonyme, deadline, privée
 */

const filterOptions = [
  "audio",
  "all",
  "only_text",
  "only_audio",
  "only_file",
  "fileAndText",
];
const roomSchema = new mongoose.Schema(
  {
    id: {type : String, required : true ,  unique: true},
    // Informations de base
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },

    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },

    description: {
      type: String,
      default: "",
      maxlength: 500,
      trim: true,
    },

    photo: {
      type: String,
    },

    // Gestion des membres
    members: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    admins: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
    ],

    // Configuration de la salle
    roomType: {
      type: String,
      enum: ["paid", "free", "localized", "anonymous", "deadline", "private"],
      default: "private",
      required: true,
    },

    isGroup: {
      type: Boolean,
      default: false,
    }, // Distinction conversation privée vs groupe

    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },

    isVerified: {
      type: Boolean,
      default: false,
      index: true,
    },

    isSearchable: {
      type: Boolean,
      default: true,
      index: true,
    },

    // Paramètres de visibilité et d'accès
    visibility: {
      type: String,
      enum: ["public", "private", "friends"],
      default: "public",
    },

    isPrivate: {
      type: Boolean,
      default: false,
      index: true,
    },

    accessCode: {
      type: String,
      unique: true,
      sparse: true, // Permet les valeurs null sans conflit d'unicité
      validate: {
        validator: function (v) {
          return !v || /^[A-Z0-9]{6,12}$/.test(v);
        },
        message:
          "Le code d'accès doit contenir 6-12 caractères alphanumériques majuscules",
      },
    },

    // Fonctionnalités spéciales
    isAnonymous: {
      type: Boolean,
      default: false,
    }, // Pour les sondages et avis anonymes

    messageDeadline: {
      type: Date,
      validate: {
        validator: function (v) {
          return !v || v > new Date();
        },
        message: "La deadline doit être dans le futur",
      },
    },

    // Configuration des messages
    messageOption: {
      type: String,
      enum: filterOptions,
      default: "all",
    },

    messageOptionsUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },

    // Système de paiement
    isPaid: {
      type: Boolean,
      default: false,
      index: true,
    },

    price: {
      type: Number,
      min: 0,
      validate: {
        validator: function (v) {
          return !this.isPaid || (v && v > 0);
        },
        message: "Le prix est requis pour les salles payantes",
      },
    },

    refundable: {
      type: Boolean,
      default: true,
    },

    refundPeriodDays: {
      type: Number,
      default: 3,
      min: 0,
      max: 30,
    },

    // Géolocalisation
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0],
        validate: {
          validator: function (v) {
            if (!v || !Array.isArray(v)) {
              return true;
            }
            return (
              v.length === 2 &&
              v[0] >= -180 &&
              v[0] <= 180 && // longitude
              v[1] >= -90 &&
              v[1] <= 90
            ); // latitude
          },
          message: "Coordonnées invalides",
        },
      },
      address: {
        type: String,
        trim: true,
        maxlength: 200,
      },
      venueName: {
        type: String,
        trim: true,
        maxlength: 100,
      },
    },

    // Système de notation
    ratings: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        rating: {
          type: Number,
          required: true,
          min: 1,
          max: 5,
        },
        comment: {
          type: String,
          maxlength: 300,
          trim: true,
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],

    averageRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
      index: true,
    },

    // Portefeuille du groupe
    wallet: {
      balance: {
        type: Number,
        default: 0,
        min: 0,
      },
      transactions: [
        {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Transaction",
        },
      ],
    },

    // Gestion des utilisateurs bannis
    bannedUsersFromRoom: [
      {
        userId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        bannedBy: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true,
        },
        reason: {
          type: String,
          required: true,
          trim: true,
          maxlength: 200,
        },
        bannedAt: {
          type: Date,
          default: Date.now,
        },
        isActive: {
          type: Boolean,
          default: true,
        },
      },
    ],
    deadlineReminderEnabled: {
      type: Boolean,
      default: false,
    },

    reminderDaysBefore: {
      type: Number,
      default: 1,
      min: 1,
      max: 30,
      validate: {
        validator: function (v) {
          return !this.deadlineReminderEnabled || (v && v > 0);
        },
        message:
          "Le nombre de jours de rappel est requis quand les rappels sont activés",
      },
    },

    customExpirationMessage: {
      type: String,
      trim: true,
      maxlength: 500,
      default: "",
    },

    // 2. Configuration pour les groupes localisés
    locationRadius: {
      type: Number,
      min: 0,
      validate: {
        validator: function (v) {
          return this.roomType !== "localisé" || (v && v > 0);
        },
        message: "Le rayon est requis pour les groupes localisés",
      },
    },

    locationUnit: {
      type: String,
      enum: ["m", "km"],
      default: "km",
      validate: {
        validator: function (v) {
          return this.roomType !== "localisé" || v;
        },
        message: "L'unité de distance est requise pour les groupes localisés",
      },
    },

    // 3. Configuration pour les groupes anonymes
    minimumAge: {
      type: Number,
      min: 13,
      max: 99,
      validate: {
        validator: function (v) {
          return !this.isAnonymous || !v || (v >= 13 && v <= 99);
        },
        message: "L'âge minimum doit être entre 13 et 99 ans",
      },
    },
    hasAgeConstraint: {
      type: Boolean,
      default: false,
    },
    optionChangeFilterByUser: {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "User",
      },
      messageOption: {
        type: String,
        enum: filterOptions,
      },
    },
    allowScreenshots: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// Virtuals
roomSchema.virtual("memberCount").get(function () {
  return this.members ? this.members.length : 0;
});

roomSchema.virtual("adminCount").get(function () {
  return this.admins ? this.admins.length : 0;
});

roomSchema.virtual("ratingCount").get(function () {
  return this.ratings ? this.ratings.length : 0;
});

// Middleware pre-save pour validation conditionnelle
roomSchema.pre("save", function (next) {
  // Validation pour les salles payantes
  if (this.isPaid && (!this.price || this.price <= 0)) {
    return next(
      new Error(
        "Le prix est requis et doit être positif pour les salles payantes"
      )
    );
  }

  // Le créateur doit être admin
  if (this.creator && (!this.admins || !this.admins.includes(this.creator))) {
    this.admins = this.admins || [];
    this.admins.push(this.creator);
  }

  // Le créateur doit être membre
  if (this.creator && (!this.members || !this.members.includes(this.creator))) {
    this.members = this.members || [];
    this.members.push(this.creator);
  }

  next();
});

// Middleware pour recalculer la note moyenne
roomSchema.pre("save", function (next) {
  if (this.ratings && this.ratings.length > 0) {
    const sum = this.ratings.reduce(
      (total, rating) => total + rating.rating,
      0
    );
    this.averageRating = Number((sum / this.ratings.length).toFixed(1));
  } else {
    this.averageRating = 0;
  }
  next();
});

roomSchema.pre("save", function (next) {
  if (this.roomType === "localisé") {
    if (!this.locationRadius || this.locationRadius <= 0) {
      return next(new Error("Le rayon est requis pour les groupes localisés"));
    }
    if (
      !this.location ||
      !this.location.coordinates ||
      this.location.coordinates.length !== 2
    ) {
      return next(
        new Error("Les coordonnées sont requises pour les groupes localisés")
      );
    }
  }
  next();
});

roomSchema.pre("save", function (next) {
  if (this.roomType === "deadline") {
    if (!this.messageDeadline) {
      return next(
        new Error("La date d'expiration est requise pour les groupes deadline")
      );
    }
    if (this.messageDeadline <= new Date()) {
      return next(new Error("La date d'expiration doit être dans le futur"));
    }
  }
  next();
});

roomSchema.methods.isExpired = function () {
  // Vérifie si la deadline est expirée
  return this.messageDeadline && this.messageDeadline <= new Date();
};

roomSchema.methods.canUserPost = function (userId) {
  //Vérifie si un utilisateur peut poster
  if (this.isExpired() && this.roomType === "deadline") {
    return this.isAdmin(userId);
  }
  return this.isMember(userId) && !this.isBanned(userId);
};

roomSchema.methods.getDaysUntilExpiration = function () {
  //Calcule les jours restants avant expiration
  if (!this.messageDeadline) return null;
  const now = new Date();
  const deadline = new Date(this.messageDeadline);
  const diffTime = deadline - now;
  return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
};

roomSchema.methods.shouldSendReminder = function () {
  //Détermine s'il faut envoyer un rappel
  if (!this.deadlineReminderEnabled || !this.messageDeadline) return false;
  const daysUntil = this.getDaysUntilExpiration();
  return daysUntil === this.reminderDaysBefore;
};

roomSchema.statics.findByAccessCode = function (accessCode) {
  return this.findOne({
    accessCode,
    isActive: true,
  });
};

roomSchema.statics.findExpiringSoon = function (days = 1) {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + days);

  return this.find({
    roomType: "deadline",
    messageDeadline: {
      $lte: futureDate,
      $gt: new Date(),
    },
    deadlineReminderEnabled: true,
    isActive: true,
  });
};

// Index pour la recherche textuelle
roomSchema.index(
  {
    name: "text",
    description: "text",
  },
  {
    weights: {
      name: 10,
      description: 5,
    },
  }
);

roomSchema.index({ messageDeadline: 1, deadlineReminderEnabled: 1 });
roomSchema.index({ locationRadius: 1, locationUnit: 1 });
roomSchema.index({ minimumAge: 1, hasAgeConstraint: 1 });

// Index géospatial pour la localisation
roomSchema.index({ "location.coordinates": "2dsphere" });

// Index composés pour les requêtes fréquentes
roomSchema.index({ roomType: 1, isActive: 1 });
roomSchema.index({ isPaid: 1, price: 1 });
roomSchema.index({ isPrivate: 1, accessCode: 1 });
roomSchema.index({ isGroup: 1, isVerified: 1 });
roomSchema.index({ visibility: 1, isSearchable: 1 });
roomSchema.index({ creator: 1, createdAt: -1 });

// Index pour les statistiques
roomSchema.index({ averageRating: -1 });
roomSchema.index({ "wallet.balance": -1 });
roomSchema.index({ memberCount: -1 });

// Index pour les utilisateurs bannis
roomSchema.index({ "bannedUsersFromRoom.userId": 1 });
roomSchema.index({ "bannedUsersFromRoom.isActive": 1 });

// Index pour les ratings
roomSchema.index({ "ratings.user": 1 });
roomSchema.index({ "ratings.createdAt": -1 });

// Méthodes d'instance
roomSchema.methods.isMember = function (userId) {
  return this.members.some(
    (memberId) => memberId.toString() === userId.toString()
  );
};

roomSchema.methods.isAdmin = function (userId) {
  return this.admins.some(
    (adminId) => adminId.toString() === userId.toString()
  );
};

roomSchema.methods.isBanned = function (userId) {
  return this.bannedUsersFromRoom.some(
    (ban) => ban.userId.toString() === userId.toString() && ban.isActive
  );
};

roomSchema.methods.addRating = function (userId, rating, comment = "") {
  // Supprimer l'ancienne note si elle existe
  this.ratings = this.ratings.filter(
    (r) => r.user.toString() !== userId.toString()
  );

  // Ajouter la nouvelle note
  this.ratings.push({
    user: userId,
    rating,
    comment,
  });

  return this.save();
};

// Méthodes statiques
roomSchema.statics.findByType = function (roomType, options = {}) {
  return this.find({ roomType, isActive: true, ...options });
};

roomSchema.statics.findNearby = function (
  longitude,
  latitude,
  maxDistance = 10000
) {
  return this.find({
    "location.coordinates": {
      $near: {
        $geometry: {
          type: "Point",
          coordinates: [longitude, latitude],
        },
        $maxDistance: maxDistance,
      },
    },
    isActive: true,
  });
};

const Room = mongoose.model("Room", roomSchema);

export default Room;
