export async function workflows(workflows: string): Promise<string> {
  return new Promise(resolve => {
    if (workflows === 'all') {
      resolve("all")
    }

    console.log(workflows)
    resolve(workflows)
  })
}
