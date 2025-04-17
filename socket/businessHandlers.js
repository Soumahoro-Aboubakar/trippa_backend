import Business from "../models/business.model.js";
import User from "../models/user.model.js";
import mongoose from "mongoose";
import { deleteMedia } from "../config/backblaze.js";

// Configuration des événements socket pour les business
export const configureBusinessSocket = (socket) => {
  // Socket handler pour créer un nouveau business
  socket.on("business:create", async (data, callback) => {
    const session = await mongoose.startSession();
    //session.startTransaction();

    try {
      const {
        name,
        description,
        category,
        coordinates,
        address,
        contactInfo,
        openingHours,
        coverMedia,
      } = data;

      // Valider les données requises
      if (!name || !category || !coordinates) {
        throw new Error("Veuillez fournir toutes les informations requises");
      }

      // Vérifier que l'utilisateur existe
      const user = await User.findById(socket.userData._id).session(session);
      if (!user) {
        throw new Error("Utilisateur non trouvé");
      }

      // Créer le nouveau business
      const newBusiness = new Business({
        owner: socket.userData._id,
        name,
        description,
        category,
        location: {
          type: "Point",
          coordinates,
          address,
        },
        contactInfo,
        openingHours,
        coverMedia,
      });

      await newBusiness.save({ session });

      //await session.commitTransaction();
      session.endSession();

      callback({
        success: true,
        message: "Business créé avec succès",
        business: newBusiness,
      });
    } catch (error) {
      //await session.abortTransaction();
      session.endSession();

      console.error(`[Business Create Error] ${error.message}`, {
        userId: socket.userData._id,
        error: error.stack,
      });

      callback({
        success: false,
        message: error.message || "Échec de la création du business",
        error: {
          code: "CREATION_FAILURE",
        },
      });
    }
  });

  // Socket handler pour mettre à jour un business existant
  socket.on("business:update", async (data, callback) => {
    const session = await mongoose.startSession();
    //session.startTransaction();

    try {
      const { businessId, updates } = data;

      // Vérifier que le business existe
      const business = await Business.findById(businessId).session(session);
      if (!business) {
        throw new Error("Business non trouvé");
      }

      // Vérifier que l'utilisateur est bien le propriétaire
      if (business.owner.toString() !== socket.userData._id.toString()) {
        throw new Error("Vous n'êtes pas autorisé à modifier ce business");
      }

      // Mettre à jour les coordonnées si fournies
      if (updates.coordinates) {
        updates.location = {
          type: "Point",
          coordinates: updates.coordinates,
          address: updates.address || business.location.address,
        };
        delete updates.coordinates;
        delete updates.address;
      }

      // Appliquer les mises à jour
      Object.keys(updates).forEach((key) => {
        business[key] = updates[key];
      });

      await business.save({ session });

      //await session.commitTransaction();
      session.endSession();

      callback({
        success: true,
        message: "Business mis à jour avec succès",
        business: business,
      });
    } catch (error) {
      //await session.abortTransaction();
      session.endSession();

      console.error(`[Business Update Error] ${error.message}`, {
        userId: socket.userData._id,
        businessId: data?.businessId,
        error: error.stack,
      });

      callback({
        success: false,
        message: error.message || "Échec de la mise à jour du business",
        error: {
          code: "UPDATE_FAILURE",
        },
      });
    }
  });

  // Socket handler pour supprimer un business
  socket.on("business:delete", async (data, callback) => {
    const session = await mongoose.startSession();
    //session.startTransaction();

    try {
      const { businessId } = data;

      // Vérifier que le business existe
      const business = await Business.findById(businessId).session(session);
      if (!business) {
        throw new Error("Business non trouvé");
      }

      // Vérifier que l'utilisateur est bien le propriétaire
      if (business.owner.toString() !== socket.userData._id.toString()) {
        throw new Error("Vous n'êtes pas autorisé à supprimer ce business");
      }

      // Supprimer les médias associés si nécessaire
      if (business.coverMedia) {
        await deleteMedia(business.coverMedia);
      }

      // Supprimer les médias des produits si nécessaire
      if (
        business.productsCollections &&
        business.productsCollections.length > 0
      ) {
        await Promise.all( //suppression en parallèle
          business.productsCollections.map(async (product) => {
            if (product.media) {
              await deleteMedia(product.media);
            }
          })
        );
      }

      // Supprimer le business
      await Business.findByIdAndDelete(businessId).session(session);

      //await session.commitTransaction();
      session.endSession();

      callback({
        success: true,
        message: "Business supprimé avec succès",
      });
    } catch (error) {
      //await session.abortTransaction();
      session.endSession();

      console.error(`[Business Delete Error] ${error.message}`, {
        userId: socket.userData._id,
        businessId: data?.businessId,
        error: error.stack,
      });

      callback({
        success: false,
        message: error.message || "Échec de la suppression du business",
        error: {
          code: "DELETE_FAILURE",
        },
      });
    }
  });

  // Socket handler pour ajouter un produit à un business
  socket.on("business:addProduct", async (data, callback) => {
    const session = await mongoose.startSession();
    //session.startTransaction();
    try {
      const { businessId, product } = data;

      // Valider les données requises
      if (
        !businessId ||
        !product ||
        !product.name ||
        !product.price ||
        !product.category ||
        !product.media
      ) {
        throw new Error("Veuillez fournir toutes les informations requises");
      }

      // Vérifier que le business existe
      const business = await Business.findById(businessId).session(session);
      if (!business) {
        throw new Error("Business non trouvé");
      }

      // Vérifier que l'utilisateur est bien le propriétaire
      if (business.owner.toString() !== socket.userData._id.toString()) {
        throw new Error("Vous n'êtes pas autorisé à modifier ce business");
      }

      // Vérifier si le nombre de produits dépasse la limite
      if (
        business.productsCollections &&
        business.productsCollections.length >= business.productLimit
      ) {
        throw new Error(
          `Vous avez atteint la limite de ${business.productLimit} produits`
        );
      }

      /*  // Traiter le média du produit si fourni
            if (product.media && product.media.startsWith('data:')) {
                try {
                    const mediaUrl = await uploadMedia(product.media);
                    product.media = mediaUrl;
                } catch (mediaError) {
                    console.error('Erreur lors du téléchargement du média:', mediaError);
                    throw new Error('Échec du téléchargement du média du produit');
                }
            } */

      // Ajouter le produit à la collection
      business.productsCollections.push(product);
      await business.save({ session });

      //await session.commitTransaction();
      session.endSession();

      callback({
        success: true,
        message: "Produit ajouté avec succès",
        product: product,
        business: business,
      });
    } catch (error) {
      //await session.abortTransaction();
      session.endSession();

      console.error(`[Business Add Product Error] ${error.message}`, {
        userId: socket.userData._id,
        businessId: data?.businessId,
        error: error.stack,
      });

      callback({
        success: false,
        message: error.message || "Échec de l'ajout du produit",
        error: {
          code: "ADD_PRODUCT_FAILURE",
        },
      });
    }
  });

  // Socket handler pour modifier ou supprimer un produit
  socket.on("business:updateProduct", async (data, callback) => {
    const session = await mongoose.startSession();
    //session.startTransaction();

    try {
      const { businessId, productId, updates, delete: shouldDelete } = data;

      // Valider les données requises
      if (!businessId || !productId) {
        throw new Error("Veuillez fournir toutes les informations requises");
      }

      // Vérifier que le business existe
      const business = await Business.findById(businessId).session(session);
      if (!business) {
        throw new Error("Business non trouvé");
      }

      // Vérifier que l'utilisateur est bien le propriétaire
      if (business.owner.toString() !== socket.userData._id.toString()) {
        throw new Error("Vous n'êtes pas autorisé à modifier ce business");
      }

      // Trouver l'index du produit dans la collection
      const productIndex = business.productsCollections.findIndex(
        (product) => product._id.toString() === productId
      );

      if (productIndex === -1) {
        throw new Error("Produit non trouvé");
      }

      if (shouldDelete) {
        // Supprimer le média du produit si existant
        if (business.productsCollections[productIndex].media) {
          try {
            await deleteMedia(business.productsCollections[productIndex].media);
          } catch (mediaError) {
            console.error(
              "Erreur lors de la suppression du média:",
              mediaError
            );
            // Continuer malgré l'erreur de suppression du média
          }
        }

        // Supprimer le produit
        business.productsCollections.splice(productIndex, 1);
        await business.save({ session });

        //await session.commitTransaction();
        session.endSession();

        callback({
          success: true,
          message: "Produit supprimé avec succès",
          business: business,
        });
      } else if (updates) {
        try {
          if (
            updates.newMedia &&
            business.productsCollections[productIndex].media
          ) {
            await deleteMedia(business.productsCollections[productIndex].media);
          }
        } catch (mediaError) {
          console.error("Erreur lors du téléchargement du média:", mediaError);
          throw new Error("Échec du téléchargement du média du produit");
        }

        // Mettre à jour le produit
        Object.keys(updates).forEach((key) => {
          business.productsCollections[productIndex][key] = updates[key];
        });

        await business.save({ session });

        //await session.commitTransaction();
        session.endSession();

        callback({
          success: true,
          message: "Produit mis à jour avec succès",
          product: business.productsCollections[productIndex],
          business: business,
        });
      } else {
        throw new Error("Aucune action spécifiée (mise à jour ou suppression)");
      }
    } catch (error) {
      //await session.abortTransaction();
      session.endSession();

      console.error(`[Business Update Product Error] ${error.message}`, {
        userId: socket.userData._id,
        businessId: data?.businessId,
        productId: data?.productId,
        error: error.stack,
      });

      callback({
        success: false,
        message: error.message || "Échec de la modification du produit",
        error: {
          code: "UPDATE_PRODUCT_FAILURE",
        },
      });
    }
  });

  /*   // Socket handler pour supprimer un produit de la collection
    socket.on('business:deleteProduct', async (data, callback) => {
        const session = await mongoose.startSession();
        //session.startTransaction();

        try {
            const { businessId, productId } = data;

            // Valider les données requises
            if (!businessId || !productId) {
                throw new Error('Veuillez fournir toutes les informations requises');
            }

            // Vérifier que le business existe
            const business = await Business.findById(businessId).session(session);
            if (!business) {
                throw new Error('Business non trouvé');
            }

            // Vérifier que l'utilisateur est bien le propriétaire
            if (business.owner.toString() !== socket.userData._id.toString()) {
                throw new Error('Vous n\'êtes pas autorisé à modifier ce business');
            }

            // Trouver l'index du produit dans la collection
            const productIndex = business.productsCollections.findIndex(
                product => product._id.toString() === productId
            );

            if (productIndex === -1) {
                throw new Error('Produit non trouvé');
            }

            // Supprimer le média du produit si existant
            if (business.productsCollections[productIndex].media) {
                try {
                    await deleteMedia(business.productsCollections[productIndex].media);
                } catch (mediaError) {
                    console.error('Erreur lors de la suppression du média:', mediaError);
                    // Continuer malgré l'erreur de suppression du média
                }
            }

            // Supprimer le produit
            business.productsCollections.splice(productIndex, 1);
            await business.save({ session });

            //await session.commitTransaction();
            session.endSession();

            callback({
                success: true,
                message: 'Produit supprimé avec succès',
                business: business
            });
        } catch (error) {
            //await session.abortTransaction();
            session.endSession();

            console.error(`[Business Delete Product Error] ${error.message}`, {
                userId: socket.userData._id,
                businessId: data?.businessId,
                productId: data?.productId,
                error: error.stack
            });

            callback({
                success: false,
                message: error.message || 'Échec de la suppression du produit',
                error: {
                    code: 'DELETE_PRODUCT_FAILURE'
                }
            });
        }
    }); */
};
