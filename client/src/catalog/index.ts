import { useProviders } from '../contexts/ProvidersContext';
import { audiotekaCatalog } from './audioteka';
import { storytelCatalog } from './storytel';
import type { CatalogApi } from './types';

export type { AuthorTarget, CatalogApi, SeriesCurrent } from './types';
export { audiotekaCatalog, storytelCatalog };

/** The catalogue of the active service; Storytel while nobody is logged in. */
export function useCatalog(): CatalogApi {
  const { active } = useProviders();
  return active === 'audioteka' ? audiotekaCatalog : storytelCatalog;
}
