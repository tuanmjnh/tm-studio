export interface ApiResponse<T = unknown> {
  success: boolean
  data?: T
  error?: {
    code: string
    message: string
    details?: unknown
  }
}

export function ok<T>(data?: T): ApiResponse<T> {
  return {
    success: true,
    data
  }
}

export function fail<T = unknown>(code: string, message: string, details?: unknown): ApiResponse<T> {
  return {
    success: false,
    error: {
      code,
      message,
      details
    }
  }
}
