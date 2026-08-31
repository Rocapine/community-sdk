import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  type ReactElement,
  type ReactNode,
} from "react";
import { resolveConfig, type CommunityConfig, type ResolvedCommunityConfig } from "./config";
import { checkSchemaVersion } from "./schema-check";

const CommunityConfigContext = createContext<ResolvedCommunityConfig | null>(null);

export function CommunityProvider(props: {
  config: CommunityConfig;
  children: ReactNode;
}): ReactElement {
  const { config, children } = props;
  const resolved = useMemo(() => resolveConfig(config), [config]);

  useEffect(() => {
    void checkSchemaVersion(resolved);
  }, [resolved]);

  return (
    <CommunityConfigContext.Provider value={resolved}>{children}</CommunityConfigContext.Provider>
  );
}

export function useCommunityConfig(): ResolvedCommunityConfig {
  const resolved = useContext(CommunityConfigContext);
  if (!resolved) {
    throw new Error("CommunityProvider is missing");
  }
  return resolved;
}
