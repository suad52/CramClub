# Virtual Library

## Implementation Brief for Claude

**Purpose:** Build a browser-based, multiplayer 3D virtual library where students can study alongside others, collaborate, and get AI-powered help without needing to meet physically or turn on their cameras.

This document is the source of truth for the initial implementation. Build a working MVP in stages. Make reasonable technical decisions where details are missing, document them, and do not silently remove the core requirements.

---

## 1. Product vision

Create a cozy, stylized university library that students can enter through a website. Each student is represented by a customizable avatar. Users can explore the library, see other students, sit at tables, talk to nearby people, collaborate on shared whiteboards, and use an AI teacher to understand uploaded lecture material.

The product should feel like a welcoming place to study with other people, not just a productivity dashboard or a generic game lobby.

### Product principles

1. **Study together without pressure:** users can participate without showing their real face or speaking.
2. **Social presence:** avatars, movement, proximity, and optional expression tracking make the space feel alive.
3. **Useful collaboration:** tables and study areas have shared tools, not just decorative objects.
4. **AI that teaches:** the AI teacher explains uploaded course material, answers questions, and creates practice activities.
5. **Privacy by design:** webcam tracking is optional and processed locally. Never upload or store raw webcam video for avatar animation.
6. **MVP first:** prioritize a stable shared 3D experience, then integrate advanced features in manageable stages.

## 2. Confirmed decisions

| Area                 | Decision                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------- |
| Environment          | Stylized, cozy university library                                                                   |
| Camera               | First-person and third-person, user-toggleable                                                      |
| Voice                | Proximity-based voice chat                                                                          |
| Priority             | Balanced across social experience, AI/facial tracking, and collaborative productivity               |
| Team size            | 1–2 developers                                                                                      |
| Standout features    | Social experience, AI teacher/facial tracking, and collaborative productivity are equally important |
| Public room capacity | 10–15 users; hard cap of 15                                                                         |
| Access               | Browser-based website with public servers                                                           |
| Movement             | WASD / arrow keys, mouse camera control                                                             |
| Webcam               | Optional; users can use a static/standard avatar without it                                         |

## 3. MVP features

### 3.1 Website, entry, and profiles

- Landing page explaining the product and offering an **Enter Library** action.
- Support guest entry if practical; otherwise implement basic Supabase authentication first.
- User can choose a display name and avatar.
- Persist profile and avatar preferences.
- Provide clear loading, connection, permission, and error states.

### 3.2 3D environment

- One cozy, stylized university library.
- Visual direction: warm wood, large windows, bookshelves, soft lighting, inviting atmosphere, whimsical but not overly game-like.
- Include desks/tables, chairs, bookshelves, and a few distinct study zones.
- Use optimized low-poly/stylized assets.
- Users can walk with WASD or arrow keys and rotate the camera with the mouse.
- Toggle first-person/third-person camera modes.
- Sit at designated chairs and stand up.
- Nearby interactable objects show a clear prompt.
- Keep the map compact and performant in a browser.

### 3.3 Avatars

- Use rigged stylized 3D avatar models.
- Small initial customization set: base appearance, hair, clothing, and one or two accessories.
- Display name above each avatar.
- Idle, walking, and sitting animations.
- Remote players see each other's movement and basic animation.
- First-person mode should hide or adjust the local avatar body/head to avoid camera clipping.
- Do not build a full character creator for the MVP.

### 3.4 Multiplayer

- Public rooms with a maximum of 15 users.
- Matchmaking joins an available room or creates a new one.
- Synchronize player position, rotation, movement state, sitting state, display name, avatar selection, study status, and reduced facial animation parameters.
- Show nearby players and a basic player list.
- Handle joining, leaving, disconnection, and reconnection.
- Validate movement and world bounds on the server.
- Use **Colyseus** for live room state. Use **Supabase** for durable data. Do not use the database as a real-time movement transport.

### 3.5 Study status and social interaction

Users can set one of these statuses:

- `Open to talk`
- `Locked in`
- `Looking to collaborate`
- `Away`

Show status in the player list and/or above nearby players. Users can mute their own microphone and mute individual users. Keep the architecture open for report/block/moderation features.

### 3.6 Optional facial/expression tracking

This is a differentiator, but must remain optional.

- Ask for webcam permission only after the user explicitly enables tracking.
- Use **MediaPipe Face Landmarker** in the browser.
- Process webcam frames locally.
- Extract and smooth a small set of values:
  - Head yaw, pitch, and roll
  - Left/right blink
  - Jaw/mouth open
  - Smile
  - Eyebrow raise
- Map values to compatible avatar rig/blendshape controls.
- Synchronize only reduced animation parameters, never raw camera frames or full facial landmark streams.
- Show a clear active indicator and obvious off switch.
- If permission is denied or tracking fails, the normal avatar must continue to work.
- Start with head pose and a few expressions; defer eye gaze if needed.
- Call this **expression tracking**, not emotion detection. Do not infer the user's emotional state.

### 3.7 Proximity voice chat

- Use **LiveKit** for WebRTC voice.
- Each library server maps to a corresponding voice room/session.
- Users can enable/disable their microphone.
- Audio volume decreases with distance and becomes inaudible outside a configurable radius.
- Provide mic permission/error states and per-user mute.
- Do not send audio through Colyseus.
- Initial implementation can calculate distance client-side using synchronized player positions and attenuate remote audio tracks. Keep the design open to server-controlled spatial subscriptions later.
- The experience must remain usable with voice disabled.

### 3.8 Collaborative tables and whiteboards

- Designate several tables as collaborative study tables.
- Interacting with a table opens its shared whiteboard.
- Each table has a stable whiteboard ID.
- Multiple users at the same table see edits in near real time.
- MVP tools: freehand drawing, text, and eraser.
- Add a shared study timer/Pomodoro if time permits.
- Suggested tools: **tldraw** for the canvas UI and **Yjs** for shared document synchronization.
- Do not assume the canvas library automatically provides multiplayer. Implement and test the collaboration provider.
- Check current tldraw SDK licensing and collaboration requirements before committing.

### 3.9 AI teacher

The AI teacher helps students understand their own uploaded course material.

MVP workflow:

1. User opens the AI teacher panel.
2. User uploads a PDF of lecture slides, notes, or course material.
3. Server validates the file and extracts text with page numbers.
4. User asks a question or chooses a teaching action.
5. Server sends relevant document context to the AI model.
6. AI responds with a grounded explanation and page references where available.
7. User can play the explanation using text-to-speech.

Include actions:

- Explain this simply
- Teach me this topic
- Give me an example
- Quiz me
- Make flashcards

Requirements:

- Clearly distinguish answers grounded in the uploaded document from general knowledge.
- Handle scanned, empty, oversized, or unsupported PDFs gracefully.
- Start with direct context for small PDFs; add chunking and retrieval/RAG when needed.
- Keep AI and TTS API keys server-side.
- Do not build a fully interruptible real-time AI character for the first release. A request/answer/voice workflow is enough.
- Use OpenAI for explanations and **ElevenLabs** for spoken responses.

### 3.10 Bookshelves and resources

- Interactive bookshelves open a resource panel.
- Organize resources by subject/topic.
- Link to useful websites, videos, papers, and study resources.
- Allow users to save resources if authentication/persistence is ready.
- Later enhancement: AI librarian that recommends resources based on a topic or uploaded notes.

## 4. Recommended technology stack

| Layer           | Technology                                      | Responsibility                             |
| --------------- | ----------------------------------------------- | ------------------------------------------ |
| Web app         | Next.js, React, TypeScript                      | Website, pages, UI, API routes             |
| 3D rendering    | Three.js, React Three Fiber, Drei               | World, avatars, camera, interactions       |
| Multiplayer     | Colyseus                                        | Public rooms, matchmaking, player state    |
| Voice           | LiveKit                                         | WebRTC voice rooms and audio tracks        |
| Auth/data       | Supabase                                        | Auth, profiles, documents, persistent data |
| Facial tracking | MediaPipe Face Landmarker                       | Local head/expression tracking             |
| Whiteboard      | tldraw + Yjs                                    | Canvas UI and collaboration                |
| AI              | OpenAI API                                      | Q&A, explanations, examples, quizzes       |
| Text-to-speech  | ElevenLabs                                      | Spoken AI explanations                     |
| PDF parsing     | PyMuPDF or suitable Node PDF parser             | Text and page extraction                   |
| 3D assets       | Blender, GLB/glTF                               | Environment and avatar preparation         |
| Hosting         | Vercel + Railway/VPS + Supabase + LiveKit Cloud | Deployment                                 |

### Stack constraints

- Use TypeScript across the main application.
- Do not add a separate Python backend initially. Use Next.js server routes for document and AI workflows unless a concrete limitation requires otherwise.
- Run Colyseus as a persistent Node process on Railway or a VPS. Do not assume serverless functions support persistent WebSocket rooms.
- Supabase is for durable data, not high-frequency player movement.
- LiveKit handles audio; Colyseus does not.
- Keep private API keys out of browser code.

## 5. Repository structure

Use a pnpm monorepo.

```text
virtual-library/
├── apps/
│   ├── web/
│   │   ├── app/
│   │   │   ├── page.tsx
│   │   │   ├── login/
│   │   │   ├── customize/
│   │   │   ├── library/
│   │   │   ├── profile/
│   │   │   └── api/
│   │   │       ├── ai/
│   │   │       ├── documents/
│   │   │       └── voice-token/
│   │   ├── components/
│   │   │   ├── ui/
│   │   │   ├── world/
│   │   │   ├── avatar/
│   │   │   ├── library/
│   │   │   ├── whiteboard/
│   │   │   ├── ai-teacher/
│   │   │   └── voice/
│   │   ├── hooks/
│   │   │   ├── useMultiplayer.ts
│   │   │   ├── useVoiceChat.ts
│   │   │   ├── useFaceTracking.ts
│   │   │   └── useKeyboardMovement.ts
│   │   ├── lib/
│   │   │   ├── supabase/
│   │   │   ├── ai/
│   │   │   ├── documents/
│   │   │   └── facial-tracking/
│   │   ├── public/
│   │   │   ├── models/
│   │   │   ├── textures/
│   │   │   ├── audio/
│   │   │   └── animations/
│   │   └── package.json
│   └── game-server/
│       ├── src/
│       │   ├── rooms/LibraryRoom.ts
│       │   ├── schemas/PlayerState.ts
│       │   ├── services/matchmaking.ts
│       │   ├── services/proximity.ts
│       │   ├── validators/
│       │   └── index.ts
│       └── package.json
├── packages/
│   ├── shared/
│   │   ├── src/types/
│   │   ├── src/constants/
│   │   ├── src/events/
│   │   └── package.json
│   └── config/
├── supabase/
│   ├── migrations/
│   └── seed.sql
├── docs/
│   ├── architecture.md
│   ├── features.md
│   └── api.md
├── .env.example
├── .gitignore
├── package.json
├── pnpm-workspace.yaml
├── tsconfig.base.json
└── README.md
```

Refine file names where useful, but preserve the boundaries between web client, real-time server, and shared contracts.

## 6. Data and state architecture

### 6.1 Persistent vs. real-time data

**Supabase stores durable information**

- User profiles
- Avatar preferences
- Uploaded document metadata and storage references
- Saved resources (later)
- Study session history (later)
- Friendships and study groups (later)

**Colyseus stores live room state**

- Connected players
- Positions and rotations
- Movement/animation state
- Sitting/standing state
- Selected avatar
- Current study status
- Reduced facial animation values
- Room membership

Do not write every movement update to Supabase.

### 6.2 Initial database tables

Start with only the tables needed for the first working build.

**`profiles`**

- `id` UUID primary key referencing Supabase auth user
- `display_name`
- `avatar_config` JSON
- `created_at`
- `updated_at`

**`documents`**

- `id` UUID primary key
- `user_id`
- `file_name`
- `storage_path`
- `mime_type`
- `file_size`
- `processing_status`
- `created_at`

Add tables for saved resources, study sessions, study groups, whiteboards, and friendships only when implementing those features. Define Row Level Security policies for user-owned records and private files.

### 6.3 Shared player contract

Create shared TypeScript types for client/server messages. The actual Colyseus state schema must use the schema types supported by the installed Colyseus version. Do not assume arbitrary nested TypeScript objects are automatically synchronized.

Suggested logical shape:

```ts
type StudyStatus = "available" | "focused" | "collaborating" | "away";

type CameraMode = "first-person" | "third-person";

interface PlayerSnapshot {
  sessionId: string;
  userId: string;
  displayName: string;
  position: { x: number; y: number; z: number };
  rotationY: number;
  isMoving: boolean;
  isSitting: boolean;
  status: StudyStatus;
  avatarConfig: {
    base: string;
    hair: string;
    outfit: string;
    accessory?: string;
  };
  facial?: {
    headYaw: number;
    headPitch: number;
    headRoll: number;
    eyeBlinkLeft: number;
    eyeBlinkRight: number;
    jawOpen: number;
    smile: number;
    browRaise: number;
  };
}
```

Camera mode can remain local unless it affects how other users see the avatar.

### 6.4 Network guidance

- Send movement updates at a controlled rate, not every render frame.
- Interpolate remote player positions.
- Send facial parameters less frequently than the local tracking/render loop.
- Avoid sending unchanged values.
- Validate movement speed and world bounds on the server.
- Clean up disconnected/stale players.

## 7. Main user flows

### Enter the library

1. User opens the website.
2. User signs in or continues as a guest if guest mode exists.
3. User confirms display name and avatar.
4. User selects **Enter Library**.
5. Client requests a public room.
6. Matchmaking joins a room with capacity or creates one.
7. User spawns at a safe spawn point.

### Study with another person

1. Two users join the same public server.
2. They see each other's avatars and names.
3. They approach a table and sit.
4. They open that table's shared whiteboard.
5. They draw/write together.
6. If enabled, proximity voice lets them talk while nearby.
7. They can set their status to `Looking to collaborate` or `Locked in`.

### Enable expression tracking

1. User opens avatar/settings controls.
2. User explicitly enables expression tracking.
3. Browser requests camera permission.
4. MediaPipe processes frames locally.
5. Local avatar responds to supported head/expression movements.
6. Only reduced animation values are synchronized.
7. User can disable tracking at any time.
8. If tracking fails, normal avatar animation continues.

### Learn from lecture slides

1. User opens AI teacher.
2. User uploads a PDF.
3. Server validates it and extracts text/page numbers.
4. User asks a question or selects a teaching action.
5. Server supplies relevant document context to the AI.
6. AI responds with explanation and page references when available.
7. User can play the response using text-to-speech.

### Use a bookshelf

1. User approaches an interactive bookshelf.
2. Interaction prompt appears.
3. User opens the resource panel.
4. User browses resources by subject/topic.
5. User opens or saves a resource.

## 8. Controls

| Input         | Action                             |
| ------------- | ---------------------------------- |
| W / A / S / D | Move                               |
| Arrow keys    | Move (alternative)                 |
| Mouse         | Rotate camera                      |
| V             | Toggle first-person / third-person |
| E             | Interact with nearby object        |
| M             | Toggle microphone                  |
| Tab           | Toggle player list                 |
| Esc           | Open settings / pause menu         |

Show a small control guide on first entry. Important actions must also be available through visible UI controls, not keyboard shortcuts alone.

## 9. Build sequence and task breakdown

Every phase must end in a working, testable result. Do not implement all features simultaneously.

### Phase 0: Foundation

- [ ] Create Git repository.
- [ ] Initialize pnpm workspace/monorepo.
- [ ] Create Next.js + TypeScript app in `apps/web`.
- [ ] Create Node + TypeScript Colyseus server in `apps/game-server`.
- [ ] Create shared package for types/constants.
- [ ] Configure linting, formatting, TypeScript, and environment variables.
- [ ] Add `.env.example` with placeholders only.
- [ ] Write README setup instructions.

**Acceptance criteria:** web app and game server both start locally; shared package imports work; a new developer can run the project by following the README.

### Phase 1: 3D library prototype

- [ ] Create the library route.
- [ ] Set up React Three Fiber and Drei.
- [ ] Build a basic library scene. Placeholder geometry is acceptable initially.
- [ ] Add lighting, ground, collision boundaries, and spawn point.
- [ ] Load a rigged avatar GLB.
- [ ] Implement WASD/arrow-key movement.
- [ ] Implement third-person camera.
- [ ] Implement first-person camera and toggle.
- [ ] Add idle/walk animation.
- [ ] Add placeholder table/chair interactions.

**Acceptance criteria:** one user can move smoothly; both camera modes work; the player cannot walk through major walls or fall out of the map; performance is acceptable on a typical laptop.

### Phase 2: Avatar and interactions

- [ ] Add display name above avatar.
- [ ] Add basic avatar customization.
- [ ] Add sitting/standing.
- [ ] Add proximity interaction prompts.
- [ ] Add quiet, collaborative, and resource study zones.
- [ ] Add settings panel.

**Acceptance criteria:** user can choose an avatar, sit/stand, and interact with nearby objects.

### Phase 3: Multiplayer and matchmaking

- [ ] Implement Colyseus `LibraryRoom`.
- [ ] Define a compatible synchronized player schema.
- [ ] Implement public-room matchmaking.
- [ ] Enforce room capacity of 15.
- [ ] Spawn players at safe positions.
- [ ] Synchronize position, rotation, movement, sitting, display name, avatar, and status.
- [ ] Render remote avatars.
- [ ] Interpolate remote movement.
- [ ] Handle disconnect/reconnect and cleanup.
- [ ] Add server-side movement validation.

**Acceptance criteria:** two or more browser sessions can join the same room and see one another move smoothly; a room never exceeds 15 users.

### Phase 4: Social presence, expression tracking, and voice

- [ ] Add study status selection and display.
- [ ] Add microphone controls and permission/error states.
- [ ] Integrate LiveKit room tokens through a secure server endpoint.
- [ ] Connect each library room to its corresponding voice room.
- [ ] Implement proximity-based volume attenuation.
- [ ] Add per-user mute.
- [ ] Integrate MediaPipe Face Landmarker locally.
- [ ] Map head pose/blendshape values to avatar animation.
- [ ] Synchronize reduced facial animation values.
- [ ] Add clear camera-active indicator and disable control.
- [ ] Test behavior when camera/mic permission is denied.

**Acceptance criteria:** nearby users can hear one another; distant users are quieter or inaudible; expression tracking works only after opt-in; no raw camera frames are sent to the server.

### Phase 5: Collaborative study tools

- [ ] Add stable IDs to collaborative tables.
- [ ] Build whiteboard panel.
- [ ] Integrate drawing, text, and eraser.
- [ ] Implement Yjs (or equivalent) synchronization.
- [ ] Scope each board to its table/room.
- [ ] Add shared Pomodoro timer if time permits.

**Acceptance criteria:** two users in the same study area see each other's whiteboard edits in near real time.

### Phase 6: AI teacher and documents

- [ ] Add secure PDF upload flow.
- [ ] Validate file type and size server-side.
- [ ] Store files in Supabase Storage with appropriate access policies.
- [ ] Extract text and page numbers.
- [ ] Add AI question/answer endpoint.
- [ ] Ground responses in uploaded content.
- [ ] Add explanation, example, quiz, and flashcard actions.
- [ ] Include page references when available.
- [ ] Integrate ElevenLabs playback.
- [ ] Handle empty/scanned/unsupported documents and API failures.

**Acceptance criteria:** user can upload a text-based PDF, ask a question, receive a relevant answer with page references when possible, and play the answer aloud.

### Phase 7: Bookshelves, polish, and deployment

- [ ] Add interactive resource bookshelf.
- [ ] Add resource categories and external links.
- [ ] Add save-resource capability if time permits.
- [ ] Optimize 3D assets, textures, and draw calls.
- [ ] Test with multiple simultaneous users.
- [ ] Test reconnects, permissions, empty states, and failures.
- [ ] Add basic moderation/reporting affordances.
- [ ] Deploy web app.
- [ ] Deploy persistent Colyseus server.
- [ ] Configure Supabase and LiveKit production settings.
- [ ] Prepare a reliable demo flow and backup.

**Acceptance criteria:** deployed demo supports the main user journey without developer-only setup.

## 10. Team split

For a two-person team:

**Developer 1: 3D/client experience**

- React Three Fiber scene and environment
- Avatar models, movement, cameras, animations
- Interactions and study-zone UI
- MediaPipe integration and avatar expression mapping
- Integration with multiplayer state

**Developer 2: backend/realtime/product systems**

- Colyseus room/server and matchmaking
- Supabase auth, profile, and document storage
- LiveKit voice and token endpoint
- Whiteboard collaboration
- PDF extraction, AI teacher, ElevenLabs
- Deployment and server configuration

**Both developers**

- Agree on shared types/events before parallel implementation.
- Integrate frequently.
- Test with two browser sessions from the beginning.
- Keep the main branch runnable.

For a solo developer, follow the same phase order but implement one vertical slice at a time. Do not attempt advanced AI, full avatar customization, and complex multiplayer infrastructure simultaneously.

## 11. Environment variables

Create `.env.example` with placeholder values only. Exact names may be adjusted to match the chosen SDKs, but keep secrets server-side.

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Game server
NEXT_PUBLIC_GAME_SERVER_URL=

# LiveKit
NEXT_PUBLIC_LIVEKIT_URL=
LIVEKIT_API_KEY=
LIVEKIT_API_SECRET=

# AI
OPENAI_API_KEY=
ELEVENLABS_API_KEY=
```

Never commit a real `.env` file or expose service-role, LiveKit secret, OpenAI, or ElevenLabs keys to the browser.

## 12. Security, privacy, and performance requirements

- Webcam expression tracking is opt-in.
- Process webcam frames locally; never upload/store raw frames for avatar animation.
- Synchronize only reduced facial animation parameters.
- Show clear camera/microphone indicators and controls.
- Users can participate without webcam or microphone.
- Issue short-lived LiveKit tokens from a secure server endpoint.
- Validate uploaded file type/size and enforce access control.
- Use Supabase Row Level Security for private user data and documents.
- Validate movement on the game server.
- Add basic mute/block/report affordances as the product matures.
- Optimize GLB models, textures, lighting, and draw calls.
- Interpolate remote movement instead of rendering raw network jumps.
- Keep network updates bounded and avoid sending unchanged data.
- Handle permission denial, disconnections, and API failures gracefully.

## 13. Demo plan

Target demo sequence:

1. Open the website and enter the library.
2. Show a stylized avatar walking through the library.
3. Open a second browser session and join the same public room.
4. Show both avatars moving and seeing each other.
5. Approach a table and sit down.
6. Enable proximity voice and demonstrate distance-based audio if available.
7. Open the shared whiteboard and draw/write from both sessions.
8. Enable optional expression tracking and show avatar response.
9. Upload a sample lecture PDF.
10. Ask the AI teacher to explain a concept and play the spoken explanation.

Prepare a backup demo with a preloaded PDF and a second browser session in case webcam permissions, network, or third-party APIs fail during judging.

## 14. Scope control: what to build first

**Must work for the first meaningful MVP**

- One polished-enough 3D library
- Movement and both camera modes
- Basic avatar and animations
- Multiplayer with public rooms capped at 15
- Remote player synchronization
- Study status
- Basic proximity voice
- One collaborative whiteboard
- Optional basic expression tracking

**Build next if time allows**

- PDF upload and AI teacher
- ElevenLabs spoken answers
- Shared Pomodoro
- Interactive resource bookshelf
- More avatar customization

**Post-hackathon**

- Full avatar creator
- Multiple environments/floors
- Friends and private rooms
- Persistent study analytics and achievements
- AI librarian and personalized resource recommendations
- More advanced document collaboration
- Advanced facial/eye tracking

The priority is balanced, but do not sacrifice a stable social 3D experience to add several incomplete integrations. If time becomes tight, ship the core room, multiplayer, and one collaborative workflow cleanly, then demonstrate the AI teacher as a working vertical slice if possible.

---

## 15. Instructions to Claude: how to start

You are the lead engineer implementing this project. Follow these instructions:

1. **Inspect the existing repository first.** If it is empty, initialize the monorepo described above. If code already exists, preserve working code and adapt the architecture rather than overwriting it.
2. **Start with Phase 0 and Phase 1 only.** Do not try to implement the entire product in one pass.
3. Before coding, provide a concise implementation checklist and identify any important assumptions or dependencies.
4. Create the actual files, install compatible package versions, and ensure scripts work. Do not merely provide code snippets or instructions.
5. Use stable, maintained package APIs. Check installed package types and documentation when an API is uncertain. Do not invent SDK methods.
6. Keep TypeScript types shared between the client and server where appropriate.
7. Use placeholder geometry/assets if final art is unavailable. Do not block progress waiting for custom models.
8. Keep the app runnable after each phase. Run lint, type checks, and relevant tests; fix errors before moving on.
9. Add or update README instructions whenever setup or run commands change.
10. Do not add fake functionality. If a feature is a placeholder, label it clearly in the UI and documentation.
11. Do not put secrets in source code. Update `.env.example` when new environment variables are required.
12. At the end of each phase, summarize files created/changed, commands to run, tests performed, known issues, and the next recommended phase.
13. Ask the user only when a decision genuinely blocks implementation. Otherwise choose a sensible default and document it.

### First coding milestone

The first milestone is deliberately small:

> A user can open the website, enter a stylized 3D library, control an avatar with WASD, and switch between first-person and third-person camera modes.

Once this works reliably, move to avatar interactions and then multiplayer. Do not begin with AI or voice integration before the 3D foundation is working.

---

## 16. Visual reference guide for Claude

This section defines the visual target for the first environment. The original planning conversation established a visual direction but did not include actual image files. Therefore, the descriptions below are **art direction references**, not photographs or assets to copy. Use them to guide asset selection, modeling, lighting, composition, and material choices.

### 16.1 Overall art direction

**Target look:** a cozy, stylized 3D university library with a polished low-poly / soft 3D-game aesthetic.

The environment should feel:

- Warm, welcoming, calm, and slightly whimsical.
- Like a place students genuinely want to spend time studying.
- Detailed enough to feel lived-in, but visually uncluttered.
- Stylized rather than photorealistic.
- Consistent across the environment, avatars, furniture, props, and UI.

Avoid:

- Photorealistic architectural rendering.
- Dark, intimidating, or abandoned-library atmospheres.
- Excessive neon, sci-fi effects, or oversaturated colors.
- Overly childish proportions or toy-like props.
- Dense decoration that makes navigation and studying difficult.

### 16.2 Environment reference: main library

**Composition**

- A medium-sized central library room with a clear view across the space.
- Tall bookshelves arranged along walls and in a few organized rows.
- Large windows that provide a visual focal point and soft natural light.
- A visible central study area with tables and chairs.
- Clear walking paths between furniture.
- A few secondary areas visible from the main room, such as a quiet corner or collaborative study area.

**Materials and palette**

- Warm oak, walnut, or similar wood for floors, desks, shelves, and trim.
- Cream, beige, muted tan, and warm neutral wall colors.
- Muted greens or blue-greens for selected furniture or decorative accents.
- Soft natural greens from a few indoor plants.
- Avoid making every surface the same shade of brown; use restrained material variation.

**Lighting**

- Soft daylight entering through large windows.
- Warm ambient interior lighting.
- Gentle shadows and subtle highlights.
- Keep the scene bright enough that avatars and interactable objects are easy to see.
- Avoid harsh contrast, blown-out windows, or dramatic horror-game lighting.

### 16.3 Study furniture and props

Create a coherent furniture set:

- Wooden rectangular and round study tables.
- Comfortable but simple chairs.
- Individual desk lamps.
- Bookshelves with varied book colors and sizes.
- A few stacks of books, notebooks, pencils, and stationery.
- Indoor plants and restrained decorative objects.
- Notice boards or small signs to identify study zones.

Props should support the feeling of a functioning library. Keep tabletops relatively clear so future whiteboard and interaction UI feels connected to the physical space.

### 16.4 Study zones

Use subtle environmental differences and signs to distinguish these zones:

1. **Quiet study area:** individual desks, softer lighting, more space between seats, minimal visual clutter.
2. **Collaborative area:** larger shared tables, chairs grouped together, visible whiteboard interaction points.
3. **Resource/bookshelf area:** bookshelves, subject labels, and interactive resource prompts.
4. **Social area (optional for MVP):** comfortable seating where users can talk without disrupting the quiet area.

Do not build separate maps for these zones in the MVP. Keep them within one navigable library environment.

### 16.5 Avatar art direction

- Stylized, friendly proportions that fit the environment.
- Clean silhouettes that remain readable from a distance.
- A small, coordinated set of hair, clothing, and accessory options.
- Soft material shading and restrained colors.
- Animations should feel relaxed and natural: idle, walk, sit, and simple expression changes.
- Avatars should not look photorealistic or clash with the environment's style.

### 16.6 Camera and composition

**Third-person**

- Keep the avatar visible and centered enough for navigation.
- Use a comfortable follow distance that shows nearby furniture and other players.
- Avoid excessive camera lag or clipping through walls and objects.

**First-person**

- Provide a stable, comfortable viewpoint.
- Hide or adjust the local avatar head/body to prevent camera clipping.
- Keep interaction prompts readable and positioned consistently.

The environment should be designed so that both camera modes are useful. Do not rely on a view that only works from one fixed camera angle.

### 16.7 Visual hierarchy and interaction feedback

- Important interactive objects (tables, seats, bookshelves) should be recognizable without UI.
- When the player enters interaction range, show a small, tasteful prompt such as `E  Study at table`.
- Use subtle highlights or outlines for interactable objects.
- Show study-zone names with simple signage.
- Keep player names/status labels legible without dominating the scene.
- Use consistent visual language for selected, hovered, disabled, and active states.

### 16.8 Asset sourcing and consistency

Claude should:

1. Start with simple placeholder geometry to establish scale, layout, movement, and camera behavior.
2. Replace placeholders with a consistent set of stylized assets as the environment takes shape.
3. Prefer GLB/glTF assets that are optimized for browser rendering.
4. Check asset licenses and attribution requirements before using external models or textures.
5. Avoid mixing realistic assets with cartoon/low-poly assets unless they are deliberately stylized to match.
6. Keep model sizes, pivots, collision shapes, and material complexity manageable.
7. Store environment models and textures under `apps/web/public/models/` and `apps/web/public/textures/`, or another clearly documented asset structure.

### 16.9 Reference-image placeholders

No actual reference image files were attached to the original project brief. Do not invent image URLs or claim that the following placeholders are supplied images. If the team later adds images, place them in a folder such as `docs/visual-references/` and update this section with their filenames and what each image is intended to communicate.

Suggested reference set to collect:

- `library-overall.png` — overall room layout, atmosphere, and composition.
- `library-lighting.png` — window light, warm interior lighting, and shadows.
- `library-furniture.png` — tables, chairs, bookshelves, and prop styling.
- `library-study-zones.png` — quiet and collaborative areas within one space.
- `avatar-style.png` — avatar proportions, materials, and animation style.
- `ui-interactions.png` — interaction prompts, player labels, and in-world signage.

When actual references are added, use them as visual guidance rather than copying a complete scene or any copyrighted game/map. The implementation should remain an original library design.

### 16.10 Visual quality acceptance checklist

- [ ] The scene reads immediately as a cozy university library.
- [ ] The art style is consistent across environment, furniture, props, and avatars.
- [ ] Warm wood, large windows, bookshelves, and soft lighting are present.
- [ ] Study tables and chairs are laid out with clear walking paths.
- [ ] Quiet and collaborative areas are visually distinguishable.
- [ ] Important interactables are easy to recognize.
- [ ] The scene is attractive in both first-person and third-person.
- [ ] The environment remains performant in a normal desktop browser.
- [ ] Placeholder assets are clearly identified and can be replaced without rewriting gameplay systems.
