export interface AuthoringMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}
