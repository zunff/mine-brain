"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** AI 回复的 markdown 渲染。思考伙伴的输出常带列表/粗体/引用，裸文本会显得廉价。 */
export function Markdown({ content }: { content: string }) {
  return (
    <div className="prose-chat">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (props) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
