// Older databases may still return the original migration's French error messages.
const messages: Record<string, string> = {
  "État invalide": "Invalid state",
  "Maximum cinq picks et cinq bans par équipe":
    "Each team can have at most five picks and five bans",
  "Poste déjà occupé": "Role already occupied",
  "Champion déjà pick ou banni": "Champion already picked or banned",
  "Champion inconnu": "Unknown champion",
  "Salle complète": "Room is full",
  "Siège déjà réservé": "Role already taken",
  "Siège déjà réservé ou invalide": "Role already taken or invalid",
  "Invitation invalide": "Invalid invitation",
  "Draft déjà démarrée": "Draft already started",
  "Pseudonyme invalide": "Invalid display name",
  "Accès refusé": "Access denied",
  "Authentification requise": "Authentication required",
  "Conflit : état actualisé, recommencez votre action":
    "Conflict: room updated. Please try again.",
  "Champion déjà utilisé ou invalide": "Champion already used or invalid",
  "Poste occupé ou invalide": "Role occupied or invalid",
  "Participants immuables": "Room membership cannot be changed here",
  "Dataset figé ou réservé à l’hôte": "Dataset is locked or host-only",
  "Action réservée à l’hôte": "Host-only action",
  "Draft terminée": "Room has ended",
  "Pool/siège non modifiable": "Pool or role cannot be edited",
  "Siège figé": "Roles are locked",
  "Préparation requise": "All players must be ready",
  "Démarrer la draft avant de terminer": "Start the draft before ending it",
  "État trop volumineux": "Room data is too large",
  "Pool invalide": "Invalid champion pool",
  "Un pool et un poste sont requis": "Choose a role and at least one champion",
};
export function errorMessage(error: unknown): string {
  const message =
    error && typeof error === "object" && "message" in error
      ? String(error.message)
      : String(error);
  return messages[message] ?? message;
}
