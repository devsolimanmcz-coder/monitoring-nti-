function getHttpErrorMessage(status) {
  if (status === 401) return 'Sua sessão expirou ou não é válida. Entre novamente.'
  if (status === 403) return 'Você não tem permissão para realizar esta ação.'
  if (status === 404) return 'O serviço solicitado não foi encontrado. Atualize a página e tente novamente.'
  if (status === 502 || status === 503 || status === 504) {
    return 'O serviço está indisponível. Verifique se a API está ativa e se os bancos de dados estão acessíveis.'
  }
  return `A API retornou um erro (HTTP ${status}). Tente novamente; se persistir, verifique os logs do servidor.`
}

function createResponseError(message, status) {
  const error = new Error(message)
  error.status = status
  return error
}

export async function parseApiResponse(response) {
  const body = await response.text()
  if (!body.trim()) {
    if (response.status === 204) return {}
    if (!response.ok) throw createResponseError(getHttpErrorMessage(response.status), response.status)
    throw createResponseError(
      `A API respondeu sem conteúdo (HTTP ${response.status}). Tente novamente.`,
      response.status,
    )
  }

  let payload
  try {
    payload = JSON.parse(body)
  } catch {
    if (!response.ok) throw createResponseError(getHttpErrorMessage(response.status), response.status)
    const isHtml = response.headers.get('content-type')?.includes('text/html') || /^\s*</.test(body)
    throw createResponseError(
      isHtml
        ? 'A API retornou uma página HTML em vez dos dados esperados. Verifique se o servidor da API está ativo.'
        : `A API retornou uma resposta inválida (HTTP ${response.status}). Tente novamente.`,
      response.status,
    )
  }

  if (payload === null || typeof payload !== 'object') {
    throw createResponseError(
      `A API retornou dados em formato inesperado (HTTP ${response.status}). Tente novamente.`,
      response.status,
    )
  }
  return payload
}

export function normalizeApiError(error, fallback) {
  const message = typeof error?.message === 'string' ? error.message.trim() : ''
  if (!message || /^(failed to fetch|load failed|networkerror when attempting to fetch resource\.?)$/i.test(message)) {
    return fallback || 'Não foi possível conectar à API. Verifique se o servidor está ativo e tente novamente.'
  }
  return message
}
