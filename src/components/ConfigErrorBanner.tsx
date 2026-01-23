import { ConfigError } from '../hooks/useConfig';
import { Banner } from './Banner';

interface ConfigErrorBannerProps {
  errors: ConfigError[];
}

export function ConfigErrorBanner({ errors }: ConfigErrorBannerProps) {
  if (errors.length === 0) return null;

  return (
    <Banner variant="error">
      <span className="font-medium text-red-100">Config error:</span>{' '}
      {errors.map((error, i) => (
        <span key={i}>
          {i > 0 && ' | '}
          <span className="text-red-300 font-mono text-xs">
            {error.file.split('/').pop()}
          </span>
          {': '}
          <span className="text-red-200">{error.message}</span>
        </span>
      ))}
    </Banner>
  );
}
