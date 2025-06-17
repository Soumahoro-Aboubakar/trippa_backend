//import { uploadFile } from '../config/backblaze.js';
import path from 'path';
import crypto from 'crypto';
import { postFile } from '../config/backblaze.js';
import { Buffer } from 'buffer';





export const handleMediaUpload = async (socket, fileData) => {
  try {
    // Reconstruire le buffer final
    const fullBuffer = Buffer.concat(fileData.buffer);
    
    // Créer l'objet fichier compatible avec postFile
    const virtualFile = {
      buffer: fullBuffer,
      originalname: fileData.fileName,
      mimetype: fileData.mimeType,
      size: fullBuffer.length
    };

    // Upload vers Backblaze
    const uploadResult = await postFile(virtualFile);
      console.log('Upload réussi:', uploadResult);

    return {
      mediaPath: uploadResult.fileId,
      mediaSize: fullBuffer.length,
      mediaDuration: fileData.mediaDuration
    };

  } catch (error) {
    console.error('Upload error:', error);
    socket.emit('upload:error', { error: 'Échec de l\'upload' });
    throw error;
  }
};



export const processMediaInput = (media) => {
  if (Buffer.isBuffer(media)) {
    return media;
  }

  if (typeof media === 'string') {
    const base64Data = media.split(',')[1] || media;
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64Data)) {
      throw new Error('Format base64 invalide');
    }

    return Buffer.from(base64Data, 'base64');
  }
  throw new Error('Type de média non supporté. Fournissez un Buffer ou une chaîne base64');
}

export const storeMedia = async (file, folder = 'general') => {
  try {
    // Générer un nom de fichier unique
    const fileExtension = path.extname(file.originalname);
    const fileName = `${folder}/${crypto.randomUUID()}${fileExtension}`;

    // Télécharger le fichier sur Backblaze
    // const fileUrl = await uploadFile(file.buffer, fileName, file.mimetype);

    return {
      url: fileUrl,
      type: getMediaType(file.mimetype),
      size: file.size
    };
  } catch (error) {
    console.error('Erreur lors du stockage du média:', error);
    throw new Error('Échec du stockage du média');
  }
};

export const getMediaType = (mimeType) => {
  if (mimeType.startsWith('image/')) return 'image';
  if (mimeType.startsWith('video/')) return 'video';
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType === 'application/pdf') return 'pdf';
  return 'documents';
};