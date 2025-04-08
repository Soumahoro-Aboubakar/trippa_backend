import Business from '../models/Business.js';
import geoService from '../services/geoService.js';
import mediaService from '../services/mediaService.js';
import mongoose from 'mongoose';

const businessController = {
  // Créer une nouvelle entreprise
  createBusiness: async (req, res) => {
    try {
      const { 
        name, 
        description, 
        category, 
        coordinates, 
        address, 
        contactInfo, 
        openingHours 
      } = req.body;

      // Valider les données requises
      if (!name || !category || !coordinates) {
        return res.status(400).json({ message: 'Veuillez fournir toutes les informations requises' });
      }

      // Gérer l'upload de photo si présent
      let photos = [];
      if (req.files && req.files.length > 0) {
        const uploadPromises = req.files.map(file => 
          mediaService.uploadMedia(file, 'business_photos') //A revoir  fichier backblaze.js
        );
        photos = await Promise.all(uploadPromises);
      }

      const newBusiness = new Business({
        owner: req.user._id,
        name,
        description,
        category,
        location: {
          type: 'Point',
          coordinates,
          address
        },
        contactInfo,
        openingHours,
        photos
      });

      await newBusiness.save();
      res.status(201).json(newBusiness);
    } catch (error) {
      console.error('Erreur lors de la création de l\'entreprise:', error);
      res.status(500).json({ message: 'Erreur lors de la création de l\'entreprise', error: error.message });
    }
  },

  // Récupérer les entreprises à proximité
  getNearbyBusinesses: async (req, res) => {
    try {
      const { longitude, latitude, radius = 1000, category } = req.query; //A revoir 
      
      if (!longitude || !latitude) {
        return res.status(400).json({ message: 'Coordonnées géographiques requises' });
      }

      const coordinates = [parseFloat(longitude), parseFloat(latitude)];
      
      // Construire la requête
      const query = {
        'location.coordinates': {
          $near: {
            $geometry: {
              type: 'Point',
              coordinates
            },
            $maxDistance: parseInt(radius)
          }
        }
      };

      // Filtrer par catégorie si spécifié
      if (category) {
        query.category = category;
      }

      const businesses = await Business.find(query).populate('owner', 'userPseudo profile.photo'); ///Fonction à revoir
      res.status(200).json(businesses);
    } catch (error) {
      console.error('Erreur lors de la récupération des entreprises:', error);
      res.status(500).json({ message: 'Erreur lors de la récupération des entreprises', error: error.message });
    }
  },

  // Récupérer une entreprise par son ID
  getBusinessById: async (req, res) => {
    try {
      const business = await Business.findById(req.params.id)
        .populate('owner', 'userPseudo profile.photo')
        .populate('ratings.user', 'userPseudo profile.photo');

      if (!business) {
        return res.status(404).json({ message: 'Entreprise non trouvée' });
      }

      res.status(200).json(business);
    } catch (error) {
      console.error('Erreur lors de la récupération de l\'entreprise:', error);
      res.status(500).json({ message: 'Erreur lors de la récupération de l\'entreprise', error: error.message });
    }
  },

  // Mettre à jour une entreprise
  updateBusiness: async (req, res) => {
    try {
      const { id } = req.params;
      const updates = req.body;
      
      // Vérifier si l'entreprise existe et appartient à l'utilisateur
      const business = await Business.findById(id);
      
      if (!business) {
        return res.status(404).json({ message: 'Entreprise non trouvée' });
      }
      
      if (business.owner.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Vous n\'êtes pas autorisé à modifier cette entreprise' });
      }

      // Gérer l'upload de nouvelles photos si présent
      if (req.files && req.files.length > 0) {
        const uploadPromises = req.files.map(file => 
          mediaService.uploadMedia(file, 'business_photos')
        );
        const newPhotos = await Promise.all(uploadPromises);
        
        // Ajouter aux photos existantes
        if (!updates.photos) {
          updates.photos = business.photos || [];
        }
        updates.photos = [...updates.photos, ...newPhotos];
      }

      // Mettre à jour les coordonnées si fournies
      if (updates.coordinates) {
        updates.location = {
          type: 'Point',
          coordinates: updates.coordinates,
          address: updates.address || business.location.address
        };
        delete updates.coordinates;
        delete updates.address;
      }

      const updatedBusiness = await Business.findByIdAndUpdate(
        id,
        { $set: updates },
        { new: true, runValidators: true }
      );

      res.status(200).json(updatedBusiness);
    } catch (error) {
      console.error('Erreur lors de la mise à jour de l\'entreprise:', error);
      res.status(500).json({ message: 'Erreur lors de la mise à jour de l\'entreprise', error: error.message });
    }
  },

  // Supprimer une entreprise
  deleteBusiness: async (req, res) => {
    try {
      const { id } = req.params;
      
      // Vérifier si l'entreprise existe et appartient à l'utilisateur
      const business = await Business.findById(id);
      
      if (!business) {
        return res.status(404).json({ message: 'Entreprise non trouvée' });
      }
      
      if (business.owner.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Vous n\'êtes pas autorisé à supprimer cette entreprise' });
      }

      // Supprimer les photos associées de Backblaze si nécessaire
      if (business.photos && business.photos.length > 0) {
        const deletePromises = business.photos.map(photoUrl => 
          mediaService.deleteMedia(photoUrl)
        );
        await Promise.all(deletePromises);
      }

      await Business.findByIdAndDelete(id);
      res.status(200).json({ message: 'Entreprise supprimée avec succès' });
    } catch (error) {
      console.error('Erreur lors de la suppression de l\'entreprise:', error);
      res.status(500).json({ message: 'Erreur lors de la suppression de l\'entreprise', error: error.message });
    }
  },

  // Ajouter ou mettre à jour un produit
  manageProduct: async (req, res) => {
    try {
      const { businessId, productId } = req.params;
      const { name, description, price } = req.body;
      
      // Vérifier si l'entreprise existe et appartient à l'utilisateur
      const business = await Business.findById(businessId);
      
      if (!business) {
        return res.status(404).json({ message: 'Entreprise non trouvée' });
      }
      
      if (business.owner.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Vous n\'êtes pas autorisé à modifier cette entreprise' });
      }

      // Gérer l'upload de photo si présent
      let photoUrl = null;
      if (req.file) {
        photoUrl = await mediaService.uploadMedia(req.file, 'product_photos');
      }

      if (productId) {
        // Mettre à jour un produit existant
        const productIndex = business.products.findIndex(p => p._id.toString() === productId);
        
        if (productIndex === -1) {
          return res.status(404).json({ message: 'Produit non trouvé' });
        }
        
        if (name) business.products[productIndex].name = name;
        if (description) business.products[productIndex].description = description;
        if (price) business.products[productIndex].price = price;
        if (photoUrl) business.products[productIndex].photo = photoUrl;
        
        await business.save();
        res.status(200).json(business.products[productIndex]);
      } else {
        // Vérifier limite de produits gratuits
        if (!business.isSubscriptionActive && business.products.length >= business.productLimit) {
          return res.status(403).json({ 
            message: 'Vous avez atteint votre limite de produits gratuits. Veuillez activer un abonnement pour en ajouter davantage.' 
          });
        }
        
        // Ajouter un nouveau produit
        const newProduct = {
          name,
          description,
          price,
          photo: photoUrl
        };
        
        business.products.push(newProduct);
        await business.save();
        res.status(201).json(business.products[business.products.length - 1]);
      }
    } catch (error) {
      console.error('Erreur lors de la gestion du produit:', error);
      res.status(500).json({ message: 'Erreur lors de la gestion du produit', error: error.message });
    }
  },

  // Supprimer un produit
  deleteProduct: async (req, res) => {
    try {
      const { businessId, productId } = req.params;
      
      // Vérifier si l'entreprise existe et appartient à l'utilisateur
      const business = await Business.findById(businessId);
      
      if (!business) {
        return res.status(404).json({ message: 'Entreprise non trouvée' });
      }
      
      if (business.owner.toString() !== req.user._id.toString()) {
        return res.status(403).json({ message: 'Vous n\'êtes pas autorisé à modifier cette entreprise' });
      }

      const productIndex = business.products.findIndex(p => p._id.toString() === productId);
      
      if (productIndex === -1) {
        return res.status(404).json({ message: 'Produit non trouvé' });
      }
      
      // Supprimer la photo du produit si elle existe
      if (business.products[productIndex].photo) {
        await mediaService.deleteMedia(business.products[productIndex].photo);
      }
      
      business.products.splice(productIndex, 1);
      await business.save();
      
      res.status(200).json({ message: 'Produit supprimé avec succès' });
    } catch (error) {
      console.error('Erreur lors de la suppression du produit:', error);
      res.status(500).json({ message: 'Erreur lors de la suppression du produit', error: error.message });
    }
  },

  // Ajouter une évaluation à une entreprise
  addRating: async (req, res) => {
    try {
      const { businessId } = req.params;
      const { rating, comment } = req.body;
      const userId = req.user._id;

      if (!rating || rating < 1 || rating > 5) {
        return res.status(400).json({ message: 'Veuillez fournir une évaluation entre 1 et 5' });
      }

      const business = await Business.findById(businessId);
      
      if (!business) {
        return res.status(404).json({ message: 'Entreprise non trouvée' });
      }

      // Vérifier si l'utilisateur a déjà évalué cette entreprise
      const existingRatingIndex = business.ratings.findIndex(
        r => r.user.toString() === userId.toString()
      );

      if (existingRatingIndex !== -1) {
        // Mettre à jour l'évaluation existante
        business.ratings[existingRatingIndex].rating = rating;
        business.ratings[existingRatingIndex].comment = comment;
        business.ratings[existingRatingIndex].createdAt = new Date();
      } else {
        // Ajouter une nouvelle évaluation
        business.ratings.push({
          user: userId,
          rating,
          comment
        });
      }

      await business.save();
      
      res.status(200).json({
        message: 'Évaluation ajoutée avec succès',
        averageRating: business.averageRating
      });
    } catch (error) {
      console.error('Erreur lors de l\'ajout de l\'évaluation:', error);
      res.status(500).json({ message: 'Erreur lors de l\'ajout de l\'évaluation', error: error.message });
    }
  },

  // Obtenir toutes les entreprises d'un utilisateur
  getUserBusinesses: async (req, res) => {
    try {
      const userId = req.params.userId || req.user._id;
      
      const businesses = await Business.find({ owner: userId })
        .sort({ createdAt: -1 });
      
      res.status(200).json(businesses);
    } catch (error) {
      console.error('Erreur lors de la récupération des entreprises:', error);
      res.status(500).json({ message: 'Erreur lors de la récupération des entreprises', error: error.message });
    }
  },

  // Vérifier une entreprise (admin seulement)
  verifyBusiness: async (req, res) => {
    try {
      // Vérifier si l'utilisateur est un administrateur
      if (!req.user.isAdmin) {
        return res.status(403).json({ message: 'Action non autorisée' });
      }

      const { businessId } = req.params;
      
      const business = await Business.findByIdAndUpdate(
        businessId,
        { $set: { isVerified: true } },
        { new: true }
      );
      
      if (!business) {
        return res.status(404).json({ message: 'Entreprise non trouvée' });
      }
      
      res.status(200).json({ 
        message: 'Entreprise vérifiée avec succès', 
        business 
      });
    } catch (error) {
      console.error('Erreur lors de la vérification de l\'entreprise:', error);
      res.status(500).json({ message: 'Erreur lors de la vérification de l\'entreprise', error: error.message });
    }
  }
};

export default businessController;