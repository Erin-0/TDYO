# Plan d'Architecture & Stratégie : Plateforme de Contribution Anonyme Sécurisée

Ce document détaille l'architecture complète, les flux de travail et les solutions techniques recommandées pour permettre à n'importe quel étudiant ou contributeur d'envoyer des documents (cours, TD, examens, résumés) de manière **totalement anonyme**, avec un espace de modération privé pour vous avant publication sur YODRIVE.

---

## 1. Objectifs & Exigences Clés

1. **Anonymat Garanti pour l'Expéditeur** :
   - Aucun compte requis, aucune connexion obligatoire (Google/Facebook/etc. optionnels ou supprimés).
   - Pas de collecte de numéro de téléphone (contrairement à WhatsApp).
   - Suppression automatique des métadonnées des fichiers (données EXIF des photos de smartphones, géolocalisation GPS, auteur dans les PDF).
2. **Contrôle et Validation par l'Administrateur** :
   - Rien n'est publié automatiquement sur le site sans votre relecture et approbation.
   - Interface ou tableau de bord dédié pour prévisualiser le fichier, modifier les informations (matière, type, titre), puis valider ou refuser.
3. **Simplicité d'Usage** :
   - Formulaire épuré, accessible directement depuis le site ou via un bouton dédié *"Proposer un document"*.
   - Drag & drop de documents (PDF, photos JPEG/PNG).

---

## 2. Options d'Implémentation Recommandées

### Option A : Backend Serverless avec Supabase & Netlify / Vercel (Recommandée - Robuste & Gratuit)

Cette option est la plus professionnelle, moderne et 100% automatisable tout en restant dans le forfait gratuit (*Free Tier*).

```
   [ Contributeur Anonyme ]
             │
             │ Envoie le fichier + Catégorie + Description (sans login)
             ▼
   [ Formulaire Web YODRIVE ]
             │
             │ Upload direct (fichier nettoyé)
             ▼
   [ Supabase Storage & Database ]
             │
             │ Statut initial: "pending" (en attente)
             │ Notification envoyée à l'administrateur (Email / Telegram Bot)
             ▼
   [ Dashboard Admin Privé ]
             │
             │ Vous visualisez le PDF, renommez si besoin, et cliquez "Approuver"
             ▼
   [ Publication Directe sur YODRIVE ]
```

#### Fonctionnalités de l'Option A :
- **Stockage de fichiers** : Supabase Storage (jusqu'à 1 Go gratuit) ou Cloudflare R2 (10 Go gratuits, sans frais de bande passante).
- **Base de données** : Supabase PostgreSQL avec Row Level Security (RLS) :
  - N'importe qui peut exécuter `INSERT` (sans savoir lire les documents des autres).
  - Seul votre compte administrateur peut faire `SELECT`, `UPDATE` et `DELETE`.
- **Nettoyage automatique des métadonnées (EXIF)** :
  - Une petite fonction Serverless (Edge Function) strip les balises EXIF (coordonnées GPS, modèle du téléphone) pour garantir 100% d'anonymat.
- **Alertes instantanées** :
  - Dès qu'un fichier est proposé, un Bot Telegram privé ou un webhook Discord vous envoie une notification avec un lien pour modérer.

---

### Option B : Formulaire Tally / Google Forms Anonyme + Google Drive (Rapide & Zéro Code Backend)

Si vous souhaitez mettre en place la solution immédiatement sans déployer de serveur ou de base de données :

```
   [ Contributeur ] ──> [ Formulaire Tally.so / Formspree ] ──> [ Dossier Google Drive Privé ]
                                                                             │
                                                                 [ Vous inspectez le fichier ]
                                                                             │
                                                                  [ Ajout manuel au site ]
```

#### Fonctionnalités de l'Option B :
- **Tally.so** ou **Fillout** :
  - Permet la soumission anonyme de fichiers sans exiger la connexion à un compte Google (contrairement à Google Forms qui force parfois la connexion pour les uploads).
  - Envoi direct des pièces jointes vers votre boîte email privée, Dropbox ou Google Drive.
- **Avantages** : Prêt en 15 minutes.
- **Inconvénients** : L'ajout au code du site reste manuel (téléchargement puis commit dans le projet).

---

### Option C : Bot Telegram Anonyme Dédié

Au lieu de WhatsApp (qui révèle le numéro de téléphone et la photo de profil), un **Bot Telegram** permet aux étudiants de vous envoyer des documents :
- Telegram cache le numéro de téléphone des utilisateurs par défaut.
- Le bot agit comme une boîte aux lettres étanche : l'étudiant envoie le fichier au bot, et le bot vous le transfère avec un identifiant aléatoire (ex: `Contributeur #104`).
- Vous pouvez même répondre via le bot (ex: *"Merci, document validé !"*) sans jamais révéler votre identité ni voir la leur.

---

## 3. Matrice de Comparaison

| Critère | Option A (Supabase / App Web) | Option B (Tally / Formulaire Web) | Option C (Bot Telegram) |
| :--- | :---: | :---: | :---: |
| **Garantie d'Anonymat** | Excellente (Métadonnées purgées) | Bonne | Bonne (Numéro masqué) |
| **Facilité pour l'utilisateur** | Maximale (intégré au site) | Élevée (formulaire externe/iframe) | Moyenne (nécessite Telegram) |
| **Expérience Administrateur** | Tableau de bord en 1 clic | Tri manuel dans Drive/Mail | Conversation Telegram |
| **Coût d'hébergement** | 0 € (Free tier Supabase/Vercel) | 0 € | 0 € |
| **Temps de mise en place** | 1 à 2 jours | 30 minutes | 1 heure |

---

## 4. Mesures de Sécurité & Modération Indispensables

1. **Validation et Restriction des Types de Fichiers** :
   - N'autoriser que les extensions strictes : `.pdf`, `.jpg`, `.jpeg`, `.png`.
   - Bloquer impérativement les scripts exécutables (`.exe`, `.bat`, `.js`, `.html`, `.zip`).
   - Limite de taille par fichier (ex: 20 Mo max).
2. **Antivirus & Analyse de Liens** :
   - Intégration possible avec l'API VirusTotal pour vérifier les fichiers suspects avant affichage.
3. **Protection Anti-Spam / Rate Limiting** :
   - Intégrer Cloudflare Turnstile (challenge invisible sans les tracas de Google reCAPTCHA) pour éviter qu'un robot n'inonde votre stockage.
   - Limitation à 5 envois par tranche de 10 minutes par adresse IP.
4. **Suppression des Données Nominatives** :
   - Conseiller aux étudiants via un avertissement visible sur le formulaire : *"Pensez à masquer votre nom sur les copies d'examen avant de les numériser"*.

---

## 5. Feuille de Route d'Intégration Proposée

1. **Étape 1** : Intégrer un bouton modale *"Proposer une ressource"* dans la barre de navigation de YODRIVE.
2. **Étape 2** : Configurer un espace de réception (Option A avec Supabase ou Option B avec un embed Tally anonyme).
3. **Étape 3** : Mettre en place un webhook de notification instantané (Telegram ou Email) pour être alerté à chaque nouvel envoi.
4. **Étape 4** : Créer l'interface de modération ou le script d'intégration rapide en 1 clic pour publier automatiquement les documents approuvés.

