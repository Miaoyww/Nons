import { createContext } from 'react'

// A detail page may place the search input beside its tabs instead of inside the list.
export const TrackSearchContext = createContext<string | undefined>(undefined)
