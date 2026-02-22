'use client';

import ReactMarkdown from 'react-markdown';

interface MarkdownContentProps {
  content: string;
  className?: string;
}

/**
 * Renders markdown content with styled prose.
 * Used in approval cards, task output modals, and pipeline output views.
 */
export function MarkdownContent({ content, className = '' }: MarkdownContentProps) {
  return (
    <div className={`mc-markdown ${className}`}>
      <ReactMarkdown
        components={{
          h1: ({ children }) => <h1 className="text-lg font-bold text-mc-text mt-4 mb-2">{children}</h1>,
          h2: ({ children }) => <h2 className="text-base font-semibold text-mc-text mt-3 mb-1.5">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold text-mc-text mt-2 mb-1">{children}</h3>,
          p: ({ children }) => <p className="text-sm text-mc-text-secondary leading-relaxed mb-2">{children}</p>,
          ul: ({ children }) => <ul className="text-sm text-mc-text-secondary list-disc pl-5 mb-2 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="text-sm text-mc-text-secondary list-decimal pl-5 mb-2 space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          strong: ({ children }) => <strong className="text-mc-text font-semibold">{children}</strong>,
          em: ({ children }) => <em className="text-mc-text-secondary italic">{children}</em>,
          code: ({ children, className: codeClass }) => {
            const isBlock = codeClass?.includes('language-');
            if (isBlock) {
              return (
                <code className="block bg-mc-bg rounded-md p-3 text-xs font-mono text-mc-text overflow-x-auto mb-2">
                  {children}
                </code>
              );
            }
            return <code className="bg-mc-bg px-1.5 py-0.5 rounded text-xs font-mono text-mc-accent">{children}</code>;
          },
          pre: ({ children }) => <pre className="mb-2">{children}</pre>,
          blockquote: ({ children }) => (
            <blockquote className="border-l-2 border-mc-accent/40 pl-3 my-2 text-sm text-mc-text-secondary italic">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="border-mc-border/30 my-3" />,
          table: ({ children }) => (
            <div className="overflow-x-auto mb-2">
              <table className="text-xs border-collapse w-full">{children}</table>
            </div>
          ),
          thead: ({ children }) => <thead className="border-b border-mc-border/50">{children}</thead>,
          th: ({ children }) => <th className="text-left px-2 py-1 text-mc-text font-medium text-xs">{children}</th>,
          td: ({ children }) => <td className="px-2 py-1 text-mc-text-secondary text-xs border-t border-mc-border/20">{children}</td>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noopener noreferrer" className="text-mc-accent hover:underline">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
