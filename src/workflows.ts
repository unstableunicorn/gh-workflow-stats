export async function getWorkflows(workflows: string): Promise<string> {
  return new Promise(resolve => {
    if (workflows === 'all') {
      resolve('all')
    }

    resolve(workflows)
  })
}
