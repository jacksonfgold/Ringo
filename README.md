# Ringo - Strategy Card Game

A mobile-first web app for playing a strategy card game with friends. Create rooms, join with room codes, and play with up to 5 players.

## Features

- Real-time multiplayer gameplay using Socket.IO
- Room-based system with unique 6-character room codes
- Support for 2-5 players
- Mobile-first responsive design
- Full implementation of strategy card game rules including:
  - Adjacent card plays
  - Split card resolution
  - RINGO mechanic
  - Pile closing rules
  - Turn-based gameplay

## Setup

### Prerequisites

- Node.js (v16 or higher)
- npm or yarn

### Installation

1. Install root dependencies:
```bash
npm install
```

2. Install server dependencies:
```bash
cd server
npm install
```

3. Install client dependencies:
```bash
cd ../client
npm install
```

## Running the Application

### Development Mode

From the root directory, run:
```bash
npm run dev
```

This will start both the server (port 3001) and client (port 3000) concurrently.

Alternatively, you can run them separately:

**Server:**
```bash
cd server
npm run dev
```

**Client:**
```bash
cd client
npm run dev
```

### Production Build

1. Build the client:
```bash
cd client
npm run build
```

2. Start the server:
```bash
cd server
npm start
```

## How to Play

1. **Create or Join a Room**
   - Enter your name
   - Click "Create Room" to create a new game room
   - Or enter a room code and click "Join Room"

2. **Start the Game**
   - Wait for at least 2 players to join
   - The room host can click "Start Game" when ready

3. **Gameplay**
   - On your turn, choose to either **Play** or **Draw**
   - To play: Select adjacent cards from your hand that form a combo of the same value
   - Your combo must beat the current combo on the table (same size, higher value)
   - If you draw a card, you can call **RINGO** if the drawn card + adjacent hand cards can form a legal play
   - First player to empty their hand wins!

## Project Structure

```
Ringo/
├── client/          # React frontend
│   ├── src/
│   │   ├── components/  # React components
│   │   ├── hooks/       # Custom hooks
│   │   └── App.jsx
│   └── package.json
├── server/          # Node.js backend
│   ├── src/
│   │   ├── game/        # Game logic
│   │   ├── rooms/       # Room management
│   │   ├── socket/      # Socket.IO handlers
│   │   └── server.js
│   └── package.json
└── package.json
```

## Technology Stack

- **Frontend**: React, Vite
- **Backend**: Node.js, Express
- **Real-time**: Socket.IO
- **Styling**: Inline styles with mobile-first approach

## Game Rules

See the plan document for detailed strategy card game rules implementation.

## License

MIT
