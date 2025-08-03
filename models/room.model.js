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
const roomSchema = new mongoose.Schema(
  {
     id : String,
    // Informations de base
    name: { 
      type: String, 
      required: true,
      trim: true,
      maxlength: 100
    },
    
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true
    },
    
    description: { 
      type: String, 
      default: "",
      maxlength: 500,
      trim: true
    },
    
    photo: {
      type: String,
      validate: {
        validator: function(v) {
          return !v || /^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)$/i.test(v);
        },
        message: "L'URL de la photo doit être valide"
      }
    },

    // Gestion des membres
    members: [{ 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User" 
    }],
    
    admins: [{ 
      type: mongoose.Schema.Types.ObjectId, 
      ref: "User" 
    }],

    // Configuration de la salle
    roomType: {
      type: String,
      enum: ["payante", "gratuite", "localisé", "annonyme", "deadline", "private"],
      default: "private",
      required: true
    },

    isGroup: { 
      type: Boolean, 
      default: false 
    }, // Distinction conversation privée vs groupe

    isActive: { 
      type: Boolean, 
      default: true,
      index: true
    },

    isVerified: { 
      type: Boolean, 
      default: false,
      index: true
    },

    isSearchable: {
      type: Boolean,
      default: true,
      index: true
    },

    // Paramètres de visibilité et d'accès
    visibility: {
      type: String,
      enum: ["public", "private", "friends"],
      default: "public"
    },

    isPrivate: { 
      type: Boolean, 
      default: false,
      index: true
    },

    accessCode: { 
      type: String, 
      unique: true, 
      sparse: true, // Permet les valeurs null sans conflit d'unicité
      validate: {
        validator: function(v) {
          return !v || /^[A-Z0-9]{6,12}$/.test(v);
        },
        message: "Le code d'accès doit contenir 6-12 caractères alphanumériques majuscules"
      }
    },

    // Fonctionnalités spéciales
    isAnonymous: { 
      type: Boolean, 
      default: false 
    }, // Pour les sondages et avis anonymes

    messageDeadline: {
      type: Date,
      validate: {
        validator: function(v) {
          return !v || v > new Date();
        },
        message: "La deadline doit être dans le futur"
      }
    },

    // Configuration des messages
    messageOptions: {
      type: String,
      enum: ["text", "audio", "all", "only_text", "only_audio", "only_file"],
      default: "all"
    },

    messageOptionsUpdatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },

    // Système de paiement
    isPaid: { 
      type: Boolean, 
      default: false,
      index: true
    },

    price: { 
      type: Number,
      min: 0,
      validate: {
        validator: function(v) {
          return !this.isPaid || (v && v > 0);
        },
        message: "Le prix est requis pour les salles payantes"
      }
    },

    refundable: {
      type: Boolean,
      default: true
    },

    refundPeriodDays: {
      type: Number,
      default: 3,
      min: 0,
      max: 30
    },

    // Géolocalisation
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point"
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0],
        validate: {
          validator: function(v) {
            return v.length === 2 && 
                   v[0] >= -180 && v[0] <= 180 && // longitude
                   v[1] >= -90 && v[1] <= 90;     // latitude
          },
          message: "Coordonnées invalides"
        }
      },
      address: {
        type: String,
        trim: true,
        maxlength: 200
      },
      venueName: {
        type: String,
        trim: true,
        maxlength: 100
      }
    },

    // Système de notation
    ratings: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
          required: true
        },
        rating: {
          type: Number,
          required: true,
          min: 1,
          max: 5
        },
        comment: {
          type: String,
          maxlength: 300,
          trim: true
        },
        createdAt: {
          type: Date,
          default: Date.now
        }
      }
    ],

    averageRating: {
      type: Number,
      default: 0,
      min: 0,
      max: 5,
      index: true
    },

    // Portefeuille du groupe
    wallet: {
      balance: { 
        type: Number, 
        default: 0,
        min: 0
      },
      transactions: [
        { 
          type: mongoose.Schema.Types.ObjectId, 
          ref: "Transaction" 
        }
      ]
    },

    // Gestion des utilisateurs bannis
    bannedUsersFromRoom: [
      {
        userId: { 
          type: mongoose.Schema.Types.ObjectId, 
          ref: "User",
          required: true
        },
        bannedBy: { 
          type: mongoose.Schema.Types.ObjectId, 
          ref: "User",
          required: true
        },
        reason: {
          type: String,
          required: true,
          trim: true,
          maxlength: 200
        },
        bannedAt: { 
          type: Date, 
          default: Date.now 
        },
        isActive: {
          type: Boolean,
          default: true
        }
      }
    ]
  },
  { 
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
  }
);

// Virtuals
roomSchema.virtual('memberCount').get(function() {
  return this.members ? this.members.length : 0;
});

roomSchema.virtual('adminCount').get(function() {
  return this.admins ? this.admins.length : 0;
});

roomSchema.virtual('ratingCount').get(function() {
  return this.ratings ? this.ratings.length : 0;
});

// Middleware pre-save pour validation conditionnelle
roomSchema.pre('save', function(next) {
  // Validation pour les salles payantes
  if (this.isPaid && (!this.price || this.price <= 0)) {
    return next(new Error('Le prix est requis et doit être positif pour les salles payantes'));
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
roomSchema.pre('save', function(next) {
  if (this.ratings && this.ratings.length > 0) {
    const sum = this.ratings.reduce((total, rating) => total + rating.rating, 0);
    this.averageRating = Number((sum / this.ratings.length).toFixed(1));
  } else {
    this.averageRating = 0;
  }
  next();
});

// Index pour la recherche textuelle
roomSchema.index({
  name: "text",
  description: "text"
}, {
  weights: {
    name: 10,
    description: 5
  }
});

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
roomSchema.methods.isMember = function(userId) {
  return this.members.some(memberId => memberId.toString() === userId.toString());
};

roomSchema.methods.isAdmin = function(userId) {
  return this.admins.some(adminId => adminId.toString() === userId.toString());
};

roomSchema.methods.isBanned = function(userId) {
  return this.bannedUsersFromRoom.some(
    ban => ban.userId.toString() === userId.toString() && ban.isActive
  );
};

roomSchema.methods.addRating = function(userId, rating, comment = '') {
  // Supprimer l'ancienne note si elle existe
  this.ratings = this.ratings.filter(r => r.user.toString() !== userId.toString());
  
  // Ajouter la nouvelle note
  this.ratings.push({
    user: userId,
    rating,
    comment
  });
  
  return this.save();
};

// Méthodes statiques
roomSchema.statics.findByType = function(roomType, options = {}) {
  return this.find({ roomType, isActive: true, ...options });
};

roomSchema.statics.findNearby = function(longitude, latitude, maxDistance = 10000) {
  return this.find({
    'location.coordinates': {
      $near: {
        $geometry: {
          type: 'Point',
          coordinates: [longitude, latitude]
        },
        $maxDistance: maxDistance
      }
    },
    isActive: true
  });
};

const Room = mongoose.model("Room", roomSchema);

export default Room;