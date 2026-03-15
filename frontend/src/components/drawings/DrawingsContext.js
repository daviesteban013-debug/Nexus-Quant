import React, { createContext, useContext, useMemo, useReducer } from 'react';

const DrawingsContext = createContext(null);

const makeId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const initialState = {
  activeTool: null,
  activeDrawingId: null,
  drawings: [],
};

function reducer(state, action) {
  switch (action.type) {
    case 'SET_TOOL':
      return { ...state, activeTool: action.tool };
    case 'SET_ACTIVE':
      return { ...state, activeDrawingId: action.id };
    case 'ADD_DRAWING': {
      const d = { ...action.drawing, id: makeId() };
      return { ...state, drawings: [...state.drawings, d], activeDrawingId: d.id };
    }
    case 'UPDATE_DRAWING': {
      const next = state.drawings.map(d => (d.id === action.id ? { ...d, ...action.patch } : d));
      return { ...state, drawings: next };
    }
    case 'DELETE_ACTIVE': {
      if (!state.activeDrawingId) return state;
      return { ...state, drawings: state.drawings.filter(d => d.id !== state.activeDrawingId), activeDrawingId: null };
    }
    case 'CLEAR_ALL':
      return { ...state, drawings: [], activeDrawingId: null };
    default:
      return state;
  }
}

export function DrawingsProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  const api = useMemo(() => {
    return {
      activeTool: state.activeTool,
      activeDrawingId: state.activeDrawingId,
      drawings: state.drawings,
      setTool: (tool) => dispatch({ type: 'SET_TOOL', tool }),
      setActive: (id) => dispatch({ type: 'SET_ACTIVE', id }),
      addDrawing: (drawing) => dispatch({ type: 'ADD_DRAWING', drawing }),
      updateDrawing: (id, patch) => dispatch({ type: 'UPDATE_DRAWING', id, patch }),
      deleteActive: () => dispatch({ type: 'DELETE_ACTIVE' }),
      clearAll: () => dispatch({ type: 'CLEAR_ALL' }),
    };
  }, [state.activeTool, state.activeDrawingId, state.drawings]);

  return <DrawingsContext.Provider value={api}>{children}</DrawingsContext.Provider>;
}

export function useDrawings() {
  const ctx = useContext(DrawingsContext);
  if (!ctx) throw new Error('useDrawings must be used within DrawingsProvider');
  return ctx;
}

