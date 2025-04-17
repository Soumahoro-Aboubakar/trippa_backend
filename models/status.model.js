import mongoose from "mongoose";
import { minimumViewThresholdDefault, pricePerViewDefault } from "../utils/globalUtils.js";

const StatusSchema = new mongoose.Schema(
  {
    creator: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    isBusiness: {
      //Les status Business sont enregistrer sous forme de collection en d'autres termes comme un tableau

      //permet d'enregistrer une collection de status très important pour les marchants afin de leur permettre plusieurs items de produits
      type: Boolean,
      default: false,
    },

    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Business",
    },
    content: {
      type: String,
    },
    mediaUrl: String,

    mediaType: {
      type: String,
      enum: ["image", "video", "text"],
      default: "text",
    },
    views: [
      {
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
        viewedAt: [
          {
            duration: { type: Number }, // durée de visualisation en secondes
            type: Date, ///prends la date de visualisation a chaque fois
          },
        ],
      },
    ],
     repostStatus: [
      {
        //lorsqu'un utilisateur partage le statut, le propriétaire du statut est notifié et à le plein pouvoir de voir les statistique de n'importe quel utilisateur qui le partegera
        user: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "User",
        },
         repostAt: {
          type: Date,
          default: Date.now,
        },
        status: {
          //très important pour les marchants
          type: String,
          enum: ["pending", "approved", "rejected"],
          default: "pending",
        },
        viewsGenerated: {
          type: Number,
          default: 0,
        },
        earnings: {
          type: Number,
          default: 0,
        },
        revenueSettings: { //permet de savoir pour quelle valeurs l'utilisateurs à publier le status et comment ils vont le gérer
          // je le remet ici car l'utilisateur changer le prix pour les nouveaux utilisateurs qui partageront son statut
          minimumViewThreshold: {
            type: Number,
            default: minimumViewThresholdDefault, // Minimum number of views required for payout
          },
          rewardPerRepost: {
            type: Number,
            default: 0, // Reward amount per successful share
          },
        },
        monetizationModel: {
          type: String,
          enum: ["free", "pay-per-view", "pay-per-purchase"],
          default: "free",
        },
        isPaid: {
          type: Boolean,
          default: false,
        },
        pricePerView: {
          // prix par vue pour le partage par utilisateur
          type: Number,
          default: pricePerViewDefault, // 0.01 unité de monnaie par vue
        },
      },
    ],
    revenueSettings: { //important pour les marchants car ils peuvent changer le prix pour les nouveaux utilisateurs qui partageront son statut
      // je le remet ici car l'utilisateur changer le prix pour les nouveaux utilisateurs qui partageront son statut
      minimumViewThreshold: {
        type: Number,
        default: 100, // Minimum number of views required for payout
      },
      rewardPerRepost: {
        type: Number,
        default: 1, // Reward amount per successful share
      },
    },
    pricePerView: {
      type: Number,
      default: 0, // 0.01 unité de monnaie par vue
    },
    totalViews: {
      type: Number,
      default: 0,
    },
    totalReposts: {
      type: Number,
      default: 0,
    },
    averageViewDuration: {
      type: Number,
      default: 0,
    },
    isPromoted: {
      type: Boolean,
      default: false,
    },
    /*   promotionRadius: {
          type: Number,
          default: 1000 // rayon de promotion en mètres
      }, */
    expiresAt: {
      type: Date,
      default: function () {
        // Par défaut, les statuts expirent après 24 heures
        const now = new Date();
        return new Date(now.setHours(now.getHours() + 24));
      },
    },
    isRepost: {
      type: Boolean,
      default: false,
    },

    isActive: { //très important au cas ou le sold de l'utisateurs est à géro et que certainnes personnes ont partager le status.
      type: Boolean,
      default: true,
    },
    repostSettings: {
      //Cat l'utilisateurs  aura la possibilité de permettre aux autres de partager ses status
      allowSharing: {
        type: Boolean,
        default: true,
      },
      requireApproval: {
        type: Boolean,
        default: true,
      },
    },
  },
  {
    timestamps: true,
  }
);

/*
// Add these fields to your StatusSchema:

sharingSettings: {
    allowSharing: {
        type: Boolean,
        default: true
    },
    requireApproval: {
        type: Boolean,
        default: false
    }
}, 
shareRequests: [{
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    },
    requestedAt: {
        type: Date,
        default: Date.now
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected'],
        default: 'pending'
    },
    monetizationModel: {
        type: String,
        enum: ['free', 'pay-per-view', 'pay-per-purchase'],
        default: 'free'
    },
    customRate: Number
}],
monetizationSettings: {
    defaultModel: {
        type: String,
        enum: ['free', 'pay-per-view', 'pay-per-purchase'],
        default: 'free'
    },
    payPerView: {
        type: Number,
        default: 0.01
    },
    commissionRate: {
        type: Number,
        default: 5
    },
    maxPayment: Number,
    validUntil: Date
}
*/

// Middleware pour mettre à jour totalViews, totalShares et averageViewDuration
StatusSchema.pre("save", function (next) {
  this.totalViews = this.views.length;
  this.totalShares = this.shares.length;

  // Calculate average view duration
  if (this.views.length > 0) {
    let totalDuration = 0;
    this.views.forEach((view) => {
      view.viewedAt.forEach((viewed) => {
        totalDuration += viewed.duration || 0;
      });
    });
    this.averageViewDuration = totalDuration / this.views.length;
  } else {
    this.averageViewDuration = 0;
  }
  next();
});

const Status = mongoose.model("Status", StatusSchema);

export default Status;
