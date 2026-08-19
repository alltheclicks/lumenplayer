/**
 * ChannelLogo Component
 *
 * Displays channel logo - handles both URL images and emoji fallback.
 */

interface ChannelLogoProps {
  logo: string;
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeClasses = {
  sm: 'w-6 h-6 text-lg',
  md: 'w-8 h-8 text-xl',
  lg: 'w-12 h-12 text-3xl',
  xl: 'w-16 h-16 text-4xl',
};

export const ChannelLogo = ({ logo, name, size = 'md', className = '' }: ChannelLogoProps) => {
  const isUrl = logo.startsWith('http://') || logo.startsWith('https://');
  const dimensions = sizeClasses[size].split(' ').slice(0, 2).join(' ');

  if (isUrl) {
    return (
      <div className={`${dimensions} flex items-center justify-center ${className}`}>
        <img
          src={logo}
          alt={name}
          className="w-full h-full object-contain rounded"
          onError={(e) => {
            const target = e.target as HTMLImageElement;
            target.onerror = null;
            target.src = '';
            target.style.display = 'none';
            if (target.parentElement) {
              target.parentElement.innerHTML = '📺';
            }
          }}
        />
      </div>
    );
  }

  return <span className={`${sizeClasses[size]} ${className}`}>{logo || '📺'}</span>;
};
