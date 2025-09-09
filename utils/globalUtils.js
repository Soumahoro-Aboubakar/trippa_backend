
import { ObjectId } from "mongodb";

export const minimumViewThresholdDefault = 100;;
export const pricePerViewDefault = 0.001;

export const  normalizeUserId = (userId) => {
  if (userId instanceof ObjectId) {
    return userId; // déjà un ObjectId
  }

  if (typeof userId === "string" && ObjectId.isValid(userId)) {
    return new ObjectId(userId); // conversion depuis string
  }

  throw new Error("L'userId fourni n'est pas valide.");
}