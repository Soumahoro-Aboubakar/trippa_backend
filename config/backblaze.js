import B2 from "backblaze-b2";
import dotenv from "dotenv";
dotenv.config();

const b2 = new B2({
  applicationKeyId: process.env.APP_KEY, // ID de la clé d'application
  applicationKey: process.env.APPLICATION_KEY, // Clé d'application
});

// Fonction pour obtenir l'URL d'upload et envoyer un fichier
const uploadFile = async (fileBuffer, fileName, mimeType, bucketId) => {
  try {
    await b2.authorize(); // Authentifier l'accès
    // Obtenir l'URL d'upload
    const uploadUrlResponse = await b2.getUploadUrl({ bucketId });
    const { uploadUrl, authorizationToken } = uploadUrlResponse.data;

    // Envoyer le fichier
    const uploadResponse = await b2.uploadFile({
      uploadUrl,
      uploadAuthToken: authorizationToken,
      fileName,
      data: fileBuffer,
      mime: mimeType,
    });

    return uploadResponse.data; // Retourner les informations du fichier uploadé
  } catch (error) {
    console.error("Erreur lors de l’upload :", error);
    throw error;
  }
};

export const deleteMedia = async (fileId) => {
  try {
    await b2.authorize(); // Authentifier l'accès
    const fileInfo = await b2.getFileInfo({ fileId });
    if(!fileInfo.data)  return { success: false, message: `File not found (fileId:${fileId})`} ;
    await b2.deleteFileVersion({
      fileId,
    });
    return { success: true, message: 'File deleted successfully' };
  } catch (error) {
    console.error("Erreur lors de la suppression du fichier :", error);
    throw error;
  }
};

export const postFile = async (file) => {
  if (!file) return null;

  try {
    const fileBuffer = file.buffer;
    const fileName = file.originalname;
    const mimeType = file.mimetype;

    return await uploadFile(
      fileBuffer,
      fileName,
      mimeType,
      process.env.BUCKET_ID
    );
  } catch (error) {
    console.error("Erreur lors de l'upload du fichier:", error);
    throw new Error("Échec de l'upload du fichier");
  }
};

export const initializeB2 = async () => {
  try {
    await b2.authorize();
    console.log("Backblaze B2 connecté avec succès");
  } catch (error) {
    console.error("Erreur de connexion à Backblaze B2:", error);
    throw error;
  }
};

export default { initializeB2, uploadFile, postFile };
