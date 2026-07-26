export interface Stage {
  id: string;
  label: string;
  position: number;
  color: string | null;
  retiredAt: string | null;
  version: number;
}

export interface Lead {
  id: string;
  stage: string;
  name: string;
  org: string | null;
  archivedAt: string | null;
  version: number;
}
