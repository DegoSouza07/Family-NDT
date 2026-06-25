# Hub de Jogos — Estrutura de Pastas

```
primohub/
├── public/
│   ├── icons/             # PWA icons (192, 512px)
│   ├── manifest.json      # PWA manifest
│   └── favicon.ico
│
├── src/
│   ├── main.jsx
│   ├── App.jsx            # Router + ProtectedRoute
│   │
│   ├── lib/
│   │   └── supabase.js    # createClient singleton
│   │
│   ├── hooks/             # Toda a lógica de negócio aqui
│   │   ├── useAuth.js         # login, signup, logout, user state
│   │   ├── useProfile.js      # perfil, avatar, byts, level
│   │   ├── useRoom.js         # criar/entrar sala, listeners realtime
│   │   ├── useGame.js         # lógica genérica: turno, vencedor
│   │   └── useRewards.js      # loja, resgatar brinde, gerar cupom
│   │
│   ├── pages/
│   │   ├── Auth.jsx           # Login + Cadastro
│   │   ├── Home.jsx           # Lobby principal ← código abaixo
│   │   ├── Profile.jsx        # Avatar, Byts, Histórico
│   │   ├── Room.jsx           # Sala de espera (aguardando oponente)
│   │   ├── Store.jsx          # Loja de Brindes
│   │   └── games/
│   │       ├── TicTacToe.jsx  # ← código completo abaixo
│   │       ├── RockPaper.jsx
│   │       ├── TruthDare.jsx
│   │       ├── Domino.jsx
│   │       ├── Checkers.jsx
│   │       ├── Uno.jsx
│   │       ├── Chess.jsx
│   │       └── Penalty.jsx
│   │
│   ├── components/
│   │   ├── layout/
│   │   │   ├── BottomNav.jsx      # Navegação mobile
│   │   │   └── Header.jsx
│   │   ├── ui/
│   │   │   ├── Avatar.jsx         # Emoji + ring colorido por nível
│   │   │   ├── BytsBadge.jsx      # Moeda animada
│   │   │   ├── GameCard.jsx       # Card de jogo no lobby
│   │   │   ├── RoomCodeInput.jsx  # Input de código de sala
│   │   │   └── Toast.jsx          # Notificações
│   │   └── game/
│   │       ├── PlayerTag.jsx      # Mini perfil dentro do jogo
│   │       ├── TurnIndicator.jsx  # "Sua vez!" / "Vez do oponente"
│   │       └── WinModal.jsx       # Popup de vitória/derrota
│   │
│   └── utils/
│       ├── roomCode.js    # gerar código 4 chars tipo "X7K2"
│       ├── byts.js        # calcular XP, subir de nível
│       └── gameLogic/
│           ├── tictactoe.js   # checkWinner, getBoardDisplay
│           ├── domino.js
│           └── chess.js       # (usa chess.js lib)
│
├── .env.local             # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
├── index.html
├── package.json
└── vite.config.js
```

## SQL — Tabelas Supabase

```sql
-- users (estende auth.users do Supabase)
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  avatar_emoji text default '😎',
  byts_balance int default 0,
  level int default 1,
  xp int default 0,
  created_at timestamptz default now()
);

-- Trigger: cria profile automaticamente no signup
create function public.handle_new_user()
returns trigger language plpgsql security definer as $$
begin
  insert into public.profiles (id, username)
  values (new.id, split_part(new.email, '@', 1));
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- games (catálogo estático, pode ser seed)
create table public.games (
  id uuid default gen_random_uuid() primary key,
  slug text unique not null,         -- 'tictactoe', 'rockpaper', etc
  name text not null,
  description text,
  emoji text,
  min_players int default 2,
  max_players int default 2,
  byts_reward int default 50,        -- ganhador recebe X byts
  is_active bool default true
);

-- rooms (salas ativas — coração do realtime)
create table public.rooms (
  id uuid default gen_random_uuid() primary key,
  code text unique not null,         -- "X7K2"
  game_id uuid references games not null,
  host_id uuid references profiles not null,
  guest_id uuid references profiles,
  status text default 'waiting',     -- waiting | playing | finished
  board_state jsonb default '{}',    -- estado do tabuleiro (game-specific)
  current_turn_id uuid references profiles,
  winner_id uuid references profiles,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- Habilitar Realtime na tabela rooms:
-- Supabase Dashboard > Database > Replication > rooms ✓

-- rewards
create table public.rewards (
  id uuid default gen_random_uuid() primary key,
  title text not null,
  description text,
  emoji text default '🎁',
  cost_byts int not null,
  stock int default -1,   -- -1 = ilimitado
  is_active bool default true
);

-- coupons
create table public.coupons (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references profiles not null,
  reward_id uuid references rewards not null,
  code text unique not null,
  is_redeemed bool default false,
  created_at timestamptz default now()
);

-- match_history
create table public.match_history (
  id uuid default gen_random_uuid() primary key,
  room_id uuid references rooms not null,
  winner_id uuid references profiles,
  loser_id uuid references profiles,
  byts_earned int default 0,
  played_at timestamptz default now()
);
```

## RLS (Row Level Security) — exemplos

```sql
-- profiles: usuário só edita o próprio perfil
alter table profiles enable row level security;
create policy "read all profiles" on profiles for select using (true);
create policy "edit own profile" on profiles for update using (auth.uid() = id);

-- rooms: qualquer logado lê, só host/guest atualiza
alter table rooms enable row level security;
create policy "read rooms" on rooms for select using (true);
create policy "create rooms" on rooms for insert with check (auth.uid() = host_id);
create policy "update rooms" on rooms for update using (
  auth.uid() = host_id or auth.uid() = guest_id
);
```
