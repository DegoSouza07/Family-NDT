// ============================================================
// PrimoHub — Hub de Jogos de Família
// Stack: React + Vite + Tailwind + Supabase
// ============================================================

// ─── src/lib/supabase.js ────────────────────────────────────
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabase = createClient(supabaseUrl, supabaseKey)


// ─── src/utils/roomCode.js ──────────────────────────────────
export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 4 }, () =>
    chars[Math.floor(Math.random() * chars.length)]
  ).join('')
}


// ─── src/utils/byts.js ──────────────────────────────────────
export const XP_PER_LEVEL = 200

export function calcLevel(xp) {
  return Math.floor(xp / XP_PER_LEVEL) + 1
}

export function xpToNextLevel(xp) {
  return XP_PER_LEVEL - (xp % XP_PER_LEVEL)
}

export function levelColor(level) {
  if (level >= 10) return 'from-yellow-400 to-orange-500' // Lenda
  if (level >= 7) return 'from-purple-500 to-pink-500'    // Mestre
  if (level >= 4) return 'from-blue-400 to-cyan-500'      // Veterano
  return 'from-green-400 to-teal-500'                      // Novato
}


// ─── src/utils/gameLogic/tictactoe.js ───────────────────────
const WINNING_LINES = [
  [0,1,2],[3,4,5],[6,7,8],  // linhas
  [0,3,6],[1,4,7],[2,5,8],  // colunas
  [0,4,8],[2,4,6]            // diagonais
]

export function checkWinner(board) {
  for (const [a, b, c] of WINNING_LINES) {
    if (board[a] && board[a] === board[b] && board[a] === board[c]) {
      return { winner: board[a], line: [a, b, c] }
    }
  }
  if (board.every(cell => cell !== null)) return { winner: 'draw', line: [] }
  return null
}

export function createInitialBoard() {
  return Array(9).fill(null)
}


// ─── src/hooks/useAuth.js ───────────────────────────────────
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export function useAuth() {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Sessão atual
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) fetchProfile(session.user.id)
      else setLoading(false)
    })

    // Listener de mudanças
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        setUser(session?.user ?? null)
        if (session?.user) await fetchProfile(session.user.id)
        else { setProfile(null); setLoading(false) }
      }
    )
    return () => subscription.unsubscribe()
  }, [])

  async function fetchProfile(userId) {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()
    setProfile(data)
    setLoading(false)
  }

  async function signUp(email, password, username) {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) throw error
    // Atualiza username gerado pelo trigger
    await supabase.from('profiles')
      .update({ username })
      .eq('id', data.user.id)
    return data
  }

  async function signIn(email, password) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email, password
    })
    if (error) throw error
    return data
  }

  async function signOut() {
    await supabase.auth.signOut()
  }

  async function updateProfile(updates) {
    const { data, error } = await supabase
      .from('profiles')
      .update(updates)
      .eq('id', user.id)
      .select()
      .maybeSingle()
    if (error) throw error
    setProfile(data)
    return data
  }

  return { user, profile, loading, signUp, signIn, signOut, updateProfile }
}


// ─── src/hooks/useRoom.js ───────────────────────────────────
import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { generateRoomCode } from '../utils/roomCode'

export function useRoom(roomCode = null) {
  const [room, setRoom] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const channelRef = useRef(null)

  // Subscribe em tempo real assim que roomCode mudar
  useEffect(() => {
    if (!roomCode) return
    fetchRoom(roomCode)
    subscribeToRoom(roomCode)
    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current)
      }
    }
  }, [roomCode])

  async function fetchRoom(code) {
    setLoading(true)
    const { data, error } = await supabase
      .from('rooms')
      .select(`
        *,
        game:games(*),
        host:profiles!rooms_host_id_fkey(*),
        guest:profiles!rooms_guest_id_fkey(*)
      `)
      .eq('code', code)
      .maybeSingle()
    if (error) setError(error.message)
    else setRoom(data)
    setLoading(false)
  }

  function subscribeToRoom(code) {
    // Canal Realtime do Supabase — ouve todas as mudanças na sala
    channelRef.current = supabase
      .channel(`room:${code}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'rooms',
          filter: `code=eq.${code}`
        },
        (payload) => {
          // Merge o novo estado com os dados relacionais que já temos
          setRoom(prev => ({
            ...prev,
            ...payload.new,
          }))
        }
      )
      .subscribe()
  }

  async function createRoom(gameId, hostId) {
    const code = generateRoomCode()
    const { data, error } = await supabase
      .from('rooms')
      .insert({
        code,
        game_id: gameId,
        host_id: hostId,
        status: 'waiting',
        board_state: {},
        current_turn_id: hostId,
      })
      .select()
      .maybeSingle()
    if (error) throw error
    return data
  }

  async function joinRoom(code, guestId) {
    // Verifica se sala existe e está aguardando
    const { data: existingRoom } = await supabase
      .from('rooms')
      .select('*')
      .eq('code', code)
      .eq('status', 'waiting')
      .maybeSingle()
    if (!existingRoom) throw new Error('Sala não encontrada ou já iniciada')
    if (existingRoom.host_id === guestId) throw new Error('Você não pode entrar na sua própria sala')

    const { data, error } = await supabase
      .from('rooms')
      .update({ guest_id: guestId, status: 'playing' })
      .eq('code', code)
      .select()
      .maybeSingle()
    if (error) throw error
    return data
  }

  async function updateBoardState(roomId, newBoardState, nextTurnId, winnerId = null) {
    const updates = {
      board_state: newBoardState,
      current_turn_id: nextTurnId,
      updated_at: new Date().toISOString(),
    }
    if (winnerId) {
      updates.winner_id = winnerId
      updates.status = 'finished'
    }
    const { error } = await supabase
      .from('rooms')
      .update(updates)
      .eq('id', roomId)
    if (error) throw error
  }

  return { room, loading, error, createRoom, joinRoom, updateBoardState }
}


// ─── src/pages/Home.jsx (LOBBY PRINCIPAL) ───────────────────
import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'
import { useRoom } from '../hooks/useRoom'
import { levelColor, calcLevel, xpToNextLevel } from '../utils/byts'

// Catálogo de jogos — em prod, busca do Supabase
const GAMES_CATALOG = [
  { slug: 'tictactoe', name: 'Jogo da Velha', emoji: '❌', description: '2 jogadores • Clássico', bytsReward: 30, active: true },
  { slug: 'rockpaper', name: 'Pedra Papel Tesoura', emoji: '✊', description: '2 jogadores • Sorte', bytsReward: 20, active: true },
  { slug: 'truthdare', name: 'Verdade ou Desafio', emoji: '🎭', description: '2-6 jogadores • Social', bytsReward: 10, active: true },
  { slug: 'domino', name: 'Dominó', emoji: '🁣', description: '2-4 jogadores • Estratégia', bytsReward: 80, active: false },
  { slug: 'checkers', name: 'Dama', emoji: '🔴', description: '2 jogadores • Estratégia', bytsReward: 60, active: false },
  { slug: 'uno', name: 'Uno', emoji: '🃏', description: '2-6 jogadores • Cartas', bytsReward: 50, active: false },
  { slug: 'chess', name: 'Xadrez', emoji: '♟️', description: '2 jogadores • Estratégia', bytsReward: 100, active: false },
  { slug: 'penalty', name: 'Pênaltis', emoji: '⚽', description: '2 jogadores • Reflexo', bytsReward: 40, active: false },
]

export default function Home() {
  const { profile, signOut } = useAuth()
  const { createRoom, joinRoom } = useRoom()
  const navigate = useNavigate()
  const [codeInput, setCodeInput] = useState('')
  const [selectedGame, setSelectedGame] = useState(null)
  const [showModal, setShowModal] = useState(null) // 'create' | 'join'
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const level = calcLevel(profile?.xp || 0)
  const xpNext = xpToNextLevel(profile?.xp || 0)
  const xpPercent = Math.round(((profile?.xp || 0) % 200) / 200 * 100)
  const gradientClass = levelColor(level)

  async function handleCreateRoom() {
    if (!selectedGame) return
    setLoading(true); setError('')
    try {
      // Em prod: busca game_id do catálogo no Supabase
      const room = await createRoom(selectedGame.slug, profile.id)
      navigate(`/room/${room.code}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleJoinRoom() {
    if (codeInput.length < 4) return
    setLoading(true); setError('')
    try {
      const room = await joinRoom(codeInput.toUpperCase(), profile.id)
      // Redireciona direto ao jogo
      navigate(`/game/${room.game_id}/${room.code}`)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white pb-24">
      {/* Header — perfil + byts */}
      <div className="px-4 pt-12 pb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            {/* Avatar */}
            <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${gradientClass}
              flex items-center justify-center text-2xl ring-2 ring-white/20`}>
              {profile?.avatar_emoji || '😎'}
            </div>
            <div>
              <p className="text-xs text-gray-400">Olá,</p>
              <p className="font-semibold text-base">{profile?.username || 'primo'}</p>
            </div>
          </div>
          {/* Byts */}
          <div className="flex items-center gap-2 bg-yellow-500/10 border border-yellow-500/20
            rounded-full px-3 py-1.5">
            <span className="text-lg">🪙</span>
            <span className="font-bold text-yellow-400 text-sm">
              {(profile?.byts_balance || 0).toLocaleString()}
            </span>
            <span className="text-xs text-yellow-600">Byts</span>
          </div>
        </div>

        {/* XP Bar */}
        <div className="bg-gray-800 rounded-2xl p-3">
          <div className="flex justify-between text-xs text-gray-400 mb-2">
            <span>Nível {level}</span>
            <span>{xpNext} XP para nível {level + 1}</span>
          </div>
          <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
            <div
              className={`h-full bg-gradient-to-r ${gradientClass} rounded-full transition-all duration-700`}
              style={{ width: `${xpPercent}%` }}
            />
          </div>
        </div>
      </div>

      {/* Ações rápidas */}
      <div className="px-4 mb-6">
        <div className="grid grid-cols-2 gap-3">
          <button
            onClick={() => setShowModal('create')}
            className="bg-purple-600 hover:bg-purple-500 active:scale-95 transition-all
              rounded-2xl p-4 text-left"
          >
            <span className="text-2xl block mb-2">🎮</span>
            <p className="font-bold text-sm">Criar Sala</p>
            <p className="text-xs text-purple-200 mt-0.5">Escolha um jogo</p>
          </button>
          <button
            onClick={() => setShowModal('join')}
            className="bg-teal-600 hover:bg-teal-500 active:scale-95 transition-all
              rounded-2xl p-4 text-left"
          >
            <span className="text-2xl block mb-2">🔑</span>
            <p className="font-bold text-sm">Entrar com Código</p>
            <p className="text-xs text-teal-200 mt-0.5">Recebeu um código?</p>
          </button>
        </div>
      </div>

      {/* Lista de jogos */}
      <div className="px-4">
        <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Jogos Disponíveis
        </h2>
        <div className="space-y-2">
          {GAMES_CATALOG.map(game => (
            <button
              key={game.slug}
              onClick={() => {
                if (!game.active) return
                setSelectedGame(game)
                setShowModal('create')
              }}
              className={`w-full flex items-center gap-4 p-4 rounded-2xl border transition-all
                ${game.active
                  ? 'bg-gray-800 border-gray-700 hover:border-purple-500 hover:bg-gray-750 active:scale-98'
                  : 'bg-gray-900 border-gray-800 opacity-50 cursor-not-allowed'
                }`}
            >
              <span className="text-3xl w-10 text-center">{game.emoji}</span>
              <div className="flex-1 text-left">
                <p className="font-semibold text-sm">{game.name}</p>
                <p className="text-xs text-gray-500">{game.description}</p>
              </div>
              <div className="text-right">
                {game.active ? (
                  <span className="text-xs bg-yellow-500/10 text-yellow-400 px-2 py-1 rounded-full">
                    +{game.bytsReward} 🪙
                  </span>
                ) : (
                  <span className="text-xs text-gray-600">Em breve</span>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Modal: Criar Sala */}
      {showModal === 'create' && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end"
          onClick={(e) => e.target === e.currentTarget && setShowModal(null)}>
          <div className="bg-gray-900 rounded-t-3xl w-full p-6 pb-10">
            <div className="w-10 h-1 bg-gray-700 rounded-full mx-auto mb-6" />
            <h3 className="text-lg font-bold mb-4">
              {selectedGame ? `Criar sala — ${selectedGame.name}` : 'Escolha um jogo'}
            </h3>

            {!selectedGame ? (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {GAMES_CATALOG.filter(g => g.active).map(game => (
                  <button
                    key={game.slug}
                    onClick={() => setSelectedGame(game)}
                    className="w-full flex items-center gap-3 p-3 bg-gray-800
                      rounded-xl hover:bg-gray-700 transition-colors"
                  >
                    <span className="text-2xl">{game.emoji}</span>
                    <span className="font-medium">{game.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div>
                <div className="flex items-center gap-3 p-4 bg-gray-800 rounded-xl mb-4">
                  <span className="text-3xl">{selectedGame.emoji}</span>
                  <div>
                    <p className="font-semibold">{selectedGame.name}</p>
                    <p className="text-sm text-gray-400">{selectedGame.description}</p>
                    <p className="text-sm text-yellow-400">+{selectedGame.bytsReward} Byts para o vencedor</p>
                  </div>
                </div>
                {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
                <button
                  onClick={handleCreateRoom}
                  disabled={loading}
                  className="w-full bg-purple-600 hover:bg-purple-500 disabled:opacity-50
                    rounded-2xl py-4 font-bold text-base transition-colors"
                >
                  {loading ? 'Criando sala...' : 'Criar Sala e Aguardar Oponente'}
                </button>
                <button
                  onClick={() => setSelectedGame(null)}
                  className="w-full mt-2 text-gray-500 text-sm py-2"
                >
                  Escolher outro jogo
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modal: Entrar com Código */}
      {showModal === 'join' && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-end"
          onClick={(e) => e.target === e.currentTarget && setShowModal(null)}>
          <div className="bg-gray-900 rounded-t-3xl w-full p-6 pb-10">
            <div className="w-10 h-1 bg-gray-700 rounded-full mx-auto mb-6" />
            <h3 className="text-lg font-bold mb-2">Entrar em uma Sala</h3>
            <p className="text-gray-400 text-sm mb-6">
              Peça o código de 4 letras para o seu primo
            </p>

            <input
              type="text"
              placeholder="Ex: X7K2"
              maxLength={4}
              value={codeInput}
              onChange={e => setCodeInput(e.target.value.toUpperCase())}
              className="w-full bg-gray-800 border border-gray-700 rounded-2xl px-4 py-4
                text-3xl font-bold text-center tracking-[0.5em] uppercase mb-4
                focus:outline-none focus:border-teal-500 transition-colors"
            />
            {error && <p className="text-red-400 text-sm mb-3">{error}</p>}
            <button
              onClick={handleJoinRoom}
              disabled={codeInput.length < 4 || loading}
              className="w-full bg-teal-600 hover:bg-teal-500 disabled:opacity-40
                disabled:cursor-not-allowed rounded-2xl py-4 font-bold text-base transition-colors"
            >
              {loading ? 'Entrando...' : 'Entrar na Sala'}
            </button>
          </div>
        </div>
      )}

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-800
        flex justify-around py-3 px-2 z-40">
        {[
          { icon: '🏠', label: 'Lobby', path: '/' },
          { icon: '👤', label: 'Perfil', path: '/profile' },
          { icon: '🛍️', label: 'Loja', path: '/store' },
        ].map(item => (
          <button
            key={item.path}
            onClick={() => navigate(item.path)}
            className="flex flex-col items-center gap-1 px-4 py-1"
          >
            <span className="text-xl">{item.icon}</span>
            <span className="text-xs text-gray-400">{item.label}</span>
          </button>
        ))}
      </nav>
    </div>
  )
}


// ─── src/pages/games/TicTacToe.jsx (MULTIPLAYER COMPLETO) ───
import React, { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useAuth } from '../../hooks/useAuth'
import { useRoom } from '../../hooks/useRoom'
import { checkWinner, createInitialBoard } from '../../utils/gameLogic/tictactoe'
import { supabase } from '../../lib/supabase'

export default function TicTacToe() {
  const { roomCode } = useParams()       // /game/tictactoe/:roomCode
  const { profile } = useAuth()
  const { room, loading, updateBoardState } = useRoom(roomCode)
  const navigate = useNavigate()
  const [winResult, setWinResult] = useState(null)

  // Derivações do estado da sala
  const board = room?.board_state?.board || createInitialBoard()
  const isMyTurn = room?.current_turn_id === profile?.id
  const iAmHost = room?.host_id === profile?.id
  const mySymbol = iAmHost ? 'X' : 'O'
  const opponentSymbol = iAmHost ? 'O' : 'X'
  const opponent = iAmHost ? room?.guest : room?.host

  // Verifica vencedor toda vez que board muda
  useEffect(() => {
    if (!room || room.status === 'waiting') return
    const result = checkWinner(board)
    if (result && !winResult) {
      setWinResult(result)
      if (room.status !== 'finished') {
        handleGameEnd(result)
      }
    }
  }, [board, room?.status])

  async function handleCellClick(index) {
    // Validações
    if (!isMyTurn) return
    if (board[index] !== null) return
    if (winResult) return
    if (room?.status !== 'playing') return

    const newBoard = [...board]
    newBoard[index] = mySymbol

    const result = checkWinner(newBoard)
    const nextTurnId = iAmHost ? room.guest_id : room.host_id
    const winnerId = result?.winner === mySymbol
      ? profile.id
      : result?.winner === 'draw'
        ? null
        : null

    try {
      await updateBoardState(
        room.id,
        { board: newBoard, lastMove: index },
        result ? null : nextTurnId,  // null = jogo acabou
        result?.winner && result.winner !== 'draw' ? profile.id : null
      )
    } catch (e) {
      console.error('Erro ao atualizar board:', e)
    }
  }

  async function handleGameEnd(result) {
    if (!profile || !room) return

    const winnerId = result.winner === mySymbol ? profile.id
      : result.winner === opponentSymbol ? (iAmHost ? room.guest_id : room.host_id)
      : null

    // Registra histórico e distribui Byts
    try {
      // Busca byts_reward do jogo
      const { data: gameData } = await supabase
        .from('games')
        .select('byts_reward')
        .eq('slug', 'tictactoe')
        .maybeSingle()

      const bytsEarned = gameData?.byts_reward || 30

      // Salva match_history
      await supabase.from('match_history').insert({
        room_id: room.id,
        winner_id: winnerId,
        loser_id: winnerId
          ? (winnerId === profile.id ? (iAmHost ? room.guest_id : room.host_id) : profile.id)
          : null,
        byts_earned: winnerId ? bytsEarned : 0,
      })

      // Credita Byts para o vencedor
      if (winnerId === profile.id) {
        await supabase.rpc('increment_byts', {
          user_id: profile.id,
          amount: bytsEarned,
        })
        // Função SQL: create function increment_byts(user_id uuid, amount int)
        // returns void language sql as $$ update profiles
        // set byts_balance = byts_balance + amount,
        //     xp = xp + amount
        // where id = user_id; $$;
      }
    } catch (e) {
      console.error('Erro ao finalizar jogo:', e)
    }
  }

  async function handleRematch() {
    // Reseta board mas mantém a sala — host passa para guest iniciar
    setWinResult(null)
    await updateBoardState(
      room.id,
      { board: createInitialBoard() },
      iAmHost ? room.guest_id : room.host_id, // oponente começa no revanche
    )
    // Atualiza status de volta para 'playing'
    await supabase
      .from('rooms')
      .update({ status: 'playing', winner_id: null })
      .eq('id', room.id)
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="text-white text-center">
        <div className="text-4xl mb-4 animate-spin">⚙️</div>
        <p>Carregando partida...</p>
      </div>
    </div>
  )

  if (room?.status === 'waiting') return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-center px-6">
      <div className="text-6xl mb-6 animate-bounce">⌛</div>
      <h2 className="text-2xl font-bold text-white mb-2">Aguardando oponente</h2>
      <p className="text-gray-400 text-center mb-8">
        Compartilhe o código com seu primo para começar
      </p>
      <div className="bg-gray-800 rounded-3xl px-8 py-6 text-center mb-6">
        <p className="text-gray-400 text-sm mb-2">Código da sala</p>
        <p className="text-5xl font-black text-white tracking-widest">{roomCode}</p>
      </div>
      <button
        onClick={() => navigator.clipboard?.writeText(roomCode)}
        className="bg-purple-600 hover:bg-purple-500 text-white rounded-2xl px-8 py-3 font-semibold"
      >
        Copiar Código
      </button>
    </div>
  )

  const winningLine = winResult?.line || []

  return (
    <div className="min-h-screen bg-gray-950 flex flex-col items-center justify-between py-12 px-4">
      {/* Placar / cabeçalho */}
      <div className="w-full max-w-sm">
        {/* Jogadores */}
        <div className="flex items-center justify-between mb-6">
          {/* Eu */}
          <div className={`flex flex-col items-center p-3 rounded-2xl flex-1
            ${isMyTurn ? 'bg-purple-600/20 ring-1 ring-purple-500' : 'bg-gray-800'}`}>
            <span className="text-3xl mb-1">{profile?.avatar_emoji || '😎'}</span>
            <p className="text-xs font-semibold text-white">{profile?.username}</p>
            <p className="text-xs text-gray-400">{mySymbol}</p>
            {isMyTurn && <p className="text-xs text-purple-400 mt-1">Sua vez!</p>}
          </div>

          <div className="px-4">
            <p className="text-gray-500 text-xl font-bold">VS</p>
          </div>

          {/* Oponente */}
          <div className={`flex flex-col items-center p-3 rounded-2xl flex-1
            ${!isMyTurn && !winResult ? 'bg-teal-600/20 ring-1 ring-teal-500' : 'bg-gray-800'}`}>
            <span className="text-3xl mb-1">{opponent?.avatar_emoji || '🙂'}</span>
            <p className="text-xs font-semibold text-white">{opponent?.username || '...'}</p>
            <p className="text-xs text-gray-400">{opponentSymbol}</p>
            {!isMyTurn && !winResult && <p className="text-xs text-teal-400 mt-1">Pensando...</p>}
          </div>
        </div>
      </div>

      {/* Tabuleiro */}
      <div className="w-full max-w-sm">
        <div className="grid grid-cols-3 gap-3">
          {board.map((cell, index) => {
            const isWinningCell = winningLine.includes(index)
            return (
              <button
                key={index}
                onClick={() => handleCellClick(index)}
                className={`
                  aspect-square rounded-2xl text-5xl font-black flex items-center justify-center
                  transition-all duration-150 active:scale-95
                  ${cell ? 'cursor-default' : isMyTurn ? 'cursor-pointer' : 'cursor-not-allowed'}
                  ${isWinningCell
                    ? 'bg-yellow-500/20 ring-2 ring-yellow-400'
                    : cell
                      ? 'bg-gray-700'
                      : 'bg-gray-800 hover:bg-gray-700'
                  }
                `}
              >
                {cell === 'X' && (
                  <span className="text-purple-400">X</span>
                )}
                {cell === 'O' && (
                  <span className="text-teal-400">O</span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Status */}
      <div className="text-center">
        {!winResult && (
          <p className="text-gray-400 text-sm">
            {isMyTurn ? '👆 Toque em uma célula' : '⏳ Aguardando oponente...'}
          </p>
        )}
        {winResult && (
          <p className="text-gray-500 text-sm">Partida encerrada</p>
        )}
      </div>

      {/* Modal de Vitória/Derrota */}
      {winResult && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center px-6">
          <div className="bg-gray-900 rounded-3xl p-8 w-full max-w-sm text-center">
            {winResult.winner === 'draw' ? (
              <>
                <div className="text-6xl mb-4">🤝</div>
                <h2 className="text-2xl font-black mb-2">Empate!</h2>
                <p className="text-gray-400">Nenhum Byts desta vez</p>
              </>
            ) : winResult.winner === mySymbol ? (
              <>
                <div className="text-6xl mb-4">🏆</div>
                <h2 className="text-2xl font-black mb-2 text-yellow-400">Você venceu!</h2>
                <p className="text-gray-400">+30 Byts creditados!</p>
                <div className="flex items-center justify-center gap-2 mt-2">
                  <span className="text-yellow-400 text-2xl">🪙</span>
                  <span className="text-3xl font-bold text-yellow-400">+30</span>
                </div>
              </>
            ) : (
              <>
                <div className="text-6xl mb-4">😤</div>
                <h2 className="text-2xl font-black mb-2">Perdeu desta vez...</h2>
                <p className="text-gray-400">Continue jogando para subir de nível!</p>
              </>
            )}

            <div className="flex gap-3 mt-6">
              <button
                onClick={handleRematch}
                className="flex-1 bg-purple-600 hover:bg-purple-500
                  rounded-2xl py-3 font-bold transition-colors"
              >
                Revanche
              </button>
              <button
                onClick={() => navigate('/')}
                className="flex-1 bg-gray-800 hover:bg-gray-700
                  rounded-2xl py-3 font-bold transition-colors"
              >
                Lobby
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ─── src/App.jsx ─────────────────────────────────────────────
import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './hooks/useAuth'
import Auth from './pages/Auth'
import Home from './pages/Home'
import TicTacToe from './pages/games/TicTacToe'

function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="min-h-screen bg-gray-950 flex items-center justify-center">
    <div className="text-4xl animate-spin">🎮</div>
  </div>
  if (!user) return <Navigate to="/auth" replace />
  return children
}

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/auth" element={<Auth />} />
        <Route path="/" element={<ProtectedRoute><Home /></ProtectedRoute>} />
        <Route path="/room/:roomCode" element={<ProtectedRoute><WaitingRoom /></ProtectedRoute>} />
        <Route path="/game/tictactoe/:roomCode" element={<ProtectedRoute><TicTacToe /></ProtectedRoute>} />
        {/* Adicionar novos jogos aqui — estrutura modular */}
      </Routes>
    </BrowserRouter>
  )
}


// ─── package.json ────────────────────────────────────────────
/*
{
  "name": "primohub",
  "version": "1.0.0",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.39.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "react-router-dom": "^6.20.0"
  },
  "devDependencies": {
    "@vitejs/plugin-react": "^4.2.0",
    "autoprefixer": "^10.4.16",
    "postcss": "^8.4.32",
    "tailwindcss": "^3.4.0",
    "vite": "^5.0.0",
    "vite-plugin-pwa": "^0.17.0"
  }
}
*/


// ─── vite.config.js ─────────────────────────────────────────
/*
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'PrimoHub',
        short_name: 'PrimoHub',
        theme_color: '#7c3aed',
        background_color: '#030712',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: '/icons/192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ]
})
*/
