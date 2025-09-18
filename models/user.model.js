import mongoose from "mongoose";
import bcrypt from "bcrypt";
import crypto from "crypto";

const Schema = mongoose.Schema;
const UserSchema = new Schema(
  {
    userPseudo: { type: String },
    phone: { type: String, required: true , unique : true },
    countryCode : { type: String, required: true},
    refreshTokens: [{ deviceId: String, token: String }],
    phoneHash: String,
    rank: {
      type: String,
      enum: ["E", "D", "C", "B", "A", "S", "SS", "S++"],
      default: "E",
    }, //inspirer de solo leveling
    userKeys: {
      lastUserPublicKey: { type: String },
      currentUserPublicKey: { type: String, required: true }, // Clé publique de l'utilisateur pour le chiffrement des messages
    }, // Clé publique de l'utilisateur pour le chiffrement des messages
    points: { type: Number, default: 10 },
    usersBanned: [
      { type: Schema.Types.ObjectId, ref: "User", banneDate: Date },
    ], // Liste des utilisateurs bannis
    loginAttempts: {
      current: {
        type: Number,
        default: 0, // Nombre de tentatives de connexion en cours
      },
      maxAllowed: {
        type: Number,
        default: 6, // Nombre maximal de tentatives autorisées avant blocage
      },
      lastAttemptDate: {
        type: Date, //   Date de la dernière tentative de connexion, une fois que le nombre de tentatives de connexion atteint le nombre maximal autorisé, l'utilisateur est bloqué pendant 24 heures
      },
    },
    KSD: { type: String, required: true }, //une numéro de téléphone unique pour chaque utilisateur pour permettre aux utilisateurs d'échanger ou de se rétrouver sans avoir à partager leur numéro de téléphone, (la longeur varien en 3 et 5 (combinaison de chiffre et de lettre exemple: 1234A,88B))) attribuer automatiquer à la création de l'utilisateur,  definition:  Konnect Secure Descriptor , slogan : Votre identifiant social sécurisé – Connectez-vous sans révéler votre numéro !
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
      },
      address: String,
      venueName: String,
    },
    email: {
      type: String,
      unique: true,
      trim: true,
      sparse: true,
    },
    verifyCode: {
      code: String,
      createdAt: {
        type: Date,
        default: Date.now,
      },
    },
    profile: {
      bio: String,
      interests: [String],
      photo: String,
      isShyMode: Boolean,
      visibility: {
        type: String,
        enum: ["public", "private", "friends"],
        default: "public",
      },
      profileViewers: [
        {
          userId: { type: Schema.Types.ObjectId, ref: "User" },
          viewedAt: {
            type: Date,
            default: Date.now,
          },
        },
      ],
      statusViewers: [
        {
          userId: { type: Schema.Types.ObjectId, ref: "User" },
          viewDuration: Number, // en secondes
          viewedAt: Date,
        },
      ],
    },
    statusShared: [
      {
        statusId: { type: Schema.Types.ObjectId, ref: "Status" },
      },
    ],
    lastLocation: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number], // [longitude, latitude]
        default: [0, 0],
      },
      updatedAt: {
        type: Date,
        default: Date.now,
      },
    },
    rooms: {
      type: [String],
      ref: "Room",
    },
    wallet: {
      balance: { type: Number, default: 0 },
      transactions: [{ type: Schema.Types.ObjectId, ref: "Payment" }],
    },
    isOnline: { type: Boolean, default: false },
    lastConnection: { type: Date },
    isVerified: { type: Boolean, default: false }, ///Pour l'optention de badge
    isNewMember: { type: Boolean, default: true },
    sharedCollections: [
      {
        //Collection des article de bissines
        originalCollection: {
          type: mongoose.Schema.Types.ObjectId,
        },
        creator: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        name: String,
        description: String,
        statuses: [
          {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Status",
          },
        ],
        sharedAt: {
          type: Date,
          default: Date.now,
        },
        monetizationModel: {
          type: String,
          enum: ["free", "pay-per-view", "pay-per-purchase"],
          default: "free",
        },
        customRate: Number,
        viewsGenerated: {
          type: Number,
          default: 0,
        },
        earnings: {
          type: Number,
          default: 0,
        },
        clientRating: {
          type: Number,
        },
      },
    ],
    messageOptions: {
      type: String,
      enum: ["text", "audio", "all", "only_text", "only_audio", "only_file"],
      default: "all",
    },
    canUsePayments: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);
/*
// Add these fields to your UserSchema:

statusCollections: [{
    name: String,
    description: String,
    statuses: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Status'
    }],
    isPublic: {
        type: Boolean,
        default: true
    },
    monetizationSettings: {
        model: {
            type: String,
            enum: ['free', 'pay-per-view', 'pay-per-purchase'],
            default: 'free'
        },
        payPerView: Number,
        commissionRate: Number,
        maxPayment: Number,
        validUntil: Date
    },
    requireApproval: {
        type: Boolean,
        default: false
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
}],
sharedCollections: [{
    originalCollection: {
        type: mongoose.Schema.Types.ObjectId
    },
    creator: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    name: String,
    description: String,
    statuses: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Status'
    }],
    sharedAt: {
        type: Date,
        default: Date.now
    },
    monetizationModel: {
        type: String,
        enum: ['free', 'pay-per-view', 'pay-per-purchase'],
        default: 'free'
    },
    customRate: Number,
    viewsGenerated: {
        type: Number,
        default: 0
    },
    earnings: {
        type: Number,
        default: 0
    }
}] */

UserSchema.index({ "location.coordinates": "2dsphere" });

/*
UserSchema.pre('save', function(next) {
  if (this.isModified('phone')) {
    try {
      const number = phoneUtil.parseAndKeepRawInput(this.phone); 
      const normalized = phoneUtil.format(number, libphonenumber.PhoneNumberFormat.E164);
      this.phone = normalized;
      this.phoneHash = crypto.createHash('sha256').update(normalized).digest('hex');
    } catch (err) {
      console.error('Erreur de normalisation', this.phone, err);
      next(err);
    }
  }
  next();
}); */
UserSchema.index({ phone: 1 }, { unique: true });
//UserSchema.index({ "phoneHash": 1 })
const User = mongoose.model("User", UserSchema);
export default User;
